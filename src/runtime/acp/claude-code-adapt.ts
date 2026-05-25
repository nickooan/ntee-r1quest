/**
 * ACP adapter for Claude Code via @agentclientprotocol/claude-agent-acp.
 *
 * Public API intentionally mirrors codex-adapt.ts so callers can switch
 * adapters through getAdaptor without changing session, prompt, permission, or
 * lifecycle handling.
 */
import { randomUUID } from "node:crypto"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
} from "@agentclientprotocol/sdk"
import { APP_NAME, VERSION } from "../version.ts"

export type ClaudeCodeAcpResponse = {
  sessionId: string
  update: SessionUpdate
}

export type ClaudeCodeAcpConversationStatus =
  | "pending"
  | "completed"
  | "failed"

export type ClaudeCodeAcpConversation = {
  id: string
  sessionId: string
  prompt: string
  updates: SessionUpdate[]
  status: ClaudeCodeAcpConversationStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  response?: PromptResponse
  error?: unknown
  acknowledgedMessageId?: string
}

export type ClaudeCodeAcpPermissionRequest = RequestPermissionRequest

export type ClaudeCodeAcpPermissionDecision =
  | {
      type: "selected"
      optionId: string
    }
  | {
      type: "cancelled"
    }

export type ClaudeCodeAcpWriteInput =
  | string
  | {
      type: "prompt"
      text: string
    }
  | {
      type: "permission"
      decision: ClaudeCodeAcpPermissionDecision
    }

export type ClaudeCodeAcpAdapterOptions = {
  cwd?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  clientName?: string
  clientVersion?: string
  onResponse?: (response: ClaudeCodeAcpResponse) => void | Promise<void>
  onConversationUpdate?: (
    conversation: ClaudeCodeAcpConversation,
  ) => void | Promise<void>
  onPermissionRequest?: (
    request: ClaudeCodeAcpPermissionRequest,
  ) =>
    | ClaudeCodeAcpPermissionDecision
    | void
    | Promise<ClaudeCodeAcpPermissionDecision | void>
  onError?: (error: unknown) => void
  onExit?: (exit: {
    code: number | null
    signal: NodeJS.Signals | null
  }) => void
}

type PendingPermission = {
  request: RequestPermissionRequest
  resolve: (response: RequestPermissionResponse) => void
}

const defaultClientName = APP_NAME
const defaultClientVersion = VERSION

const toPermissionResponse = (
  decision: ClaudeCodeAcpPermissionDecision,
): RequestPermissionResponse => {
  if (decision.type === "cancelled") {
    return {
      outcome: {
        outcome: "cancelled",
      },
    }
  }

  return {
    outcome: {
      outcome: "selected",
      optionId: decision.optionId,
    },
  }
}

const createCancelledPermissionResponse = (): RequestPermissionResponse => {
  return {
    outcome: {
      outcome: "cancelled",
    },
  }
}

export class ClaudeCodeAcpAdapter {
  private readonly cwd: string
  private readonly args: string[]
  private readonly env: NodeJS.ProcessEnv
  private readonly clientName: string
  private readonly clientVersion: string
  private readonly onResponse?: ClaudeCodeAcpAdapterOptions["onResponse"]
  private readonly onConversationUpdate?: ClaudeCodeAcpAdapterOptions["onConversationUpdate"]
  private readonly onPermissionRequest?: ClaudeCodeAcpAdapterOptions["onPermissionRequest"]
  private readonly onError?: ClaudeCodeAcpAdapterOptions["onError"]
  private readonly onExit?: ClaudeCodeAcpAdapterOptions["onExit"]
  private process?: ChildProcessWithoutNullStreams
  private connection?: ClientSideConnection
  private sessionId?: string
  private pendingPermission?: PendingPermission
  private runPromise?: Promise<this>
  private readonly conversations = new Map<string, ClaudeCodeAcpConversation>()
  private activeConversationId?: string
  private isStopping = false

  constructor(options: ClaudeCodeAcpAdapterOptions = {}) {
    this.cwd = options.cwd ?? process.cwd()
    this.args = options.args ?? []
    this.env = {
      ...process.env,
      ...options.env,
    }
    this.clientName = options.clientName ?? defaultClientName
    this.clientVersion = options.clientVersion ?? defaultClientVersion
    this.onResponse = options.onResponse
    this.onConversationUpdate = options.onConversationUpdate
    this.onPermissionRequest = options.onPermissionRequest
    this.onError = options.onError
    this.onExit = options.onExit
  }

  get isRunning(): boolean {
    return this.process !== undefined && !this.process.killed
  }

  get currentSessionId(): string | undefined {
    return this.sessionId
  }

  get currentPermissionRequest(): ClaudeCodeAcpPermissionRequest | undefined {
    return this.pendingPermission?.request
  }

  get promptConversations(): ClaudeCodeAcpConversation[] {
    return Array.from(this.conversations.values(), copyConversation)
  }

  get unfinishedPromptConversations(): ClaudeCodeAcpConversation[] {
    return this.promptConversations.filter((conversation) => {
      return conversation.status === "pending"
    })
  }

  async run(): Promise<this> {
    if (this.connection && this.sessionId) {
      return this
    }

    if (this.runPromise) {
      return this.runPromise
    }

    this.runPromise = this.start()

    try {
      return await this.runPromise
    } finally {
      this.runPromise = undefined
    }
  }

  private async start(): Promise<this> {
    const claudeAcpPath = fileURLToPath(
      import.meta
        .resolve("@agentclientprotocol/claude-agent-acp/dist/index.js"),
    )
    const childProcess = spawn(
      process.execPath,
      [claudeAcpPath, ...this.args],
      {
        cwd: this.cwd,
        env: this.env,
        stdio: "pipe",
      },
    )

    this.isStopping = false
    this.process = childProcess
    childProcess.once("error", (error) => {
      this.reportError(error)
    })
    childProcess.once("exit", (code, signal) => {
      if (!this.isStopping && code !== 0) {
        this.reportError(
          new Error(
            `Claude Code ACP exited${code === null ? "" : ` with code ${code}`}${
              signal ? ` and signal ${signal}` : ""
            }.`,
          ),
        )
      }

      this.onExit?.({ code, signal })
    })
    childProcess.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString().trim()

      if (message) {
        this.reportError(new Error(message))
      }
    })

    const client: Client = {
      requestPermission: async (request) => {
        return this.handlePermissionRequest(request)
      },
      sessionUpdate: async (notification) => {
        await this.handleSessionUpdate(notification)
      },
    }

    const stream = ndJsonStream(
      Writable.toWeb(childProcess.stdin),
      Readable.toWeb(childProcess.stdout),
    )
    const connection = new ClientSideConnection(() => client, stream)
    this.connection = connection
    connection.closed.catch((error: unknown) => {
      this.reportError(error)
    })

    try {
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: this.clientName,
          version: this.clientVersion,
        },
        clientCapabilities: {},
      })

      const session = await connection.newSession({
        cwd: this.cwd,
        mcpServers: [],
      })
      this.sessionId = session.sessionId

      return this
    } catch (error) {
      this.reportError(error)
      this.stop()
      throw error
    }
  }

  async write(input: ClaudeCodeAcpWriteInput): Promise<PromptResponse | void> {
    if (typeof input === "string") {
      return this.sendPrompt(input)
    }

    if (input.type === "prompt") {
      return this.sendPrompt(input.text)
    }

    return this.resolvePermission(input.decision)
  }

  stop(): void {
    this.isStopping = true

    if (this.pendingPermission) {
      this.pendingPermission.resolve(createCancelledPermissionResponse())
      this.pendingPermission = undefined
    }

    this.process?.kill()
    this.process = undefined
    this.connection = undefined
    this.sessionId = undefined
    this.runPromise = undefined
    this.activeConversationId = undefined
  }

  private async sendPrompt(text: string): Promise<PromptResponse> {
    const trimmedText = text.trim()

    if (!trimmedText) {
      throw new Error("Cannot send an empty prompt to Claude Code ACP.")
    }

    if (!this.connection || !this.sessionId) {
      await this.run()
    }

    if (!this.connection || !this.sessionId) {
      throw new Error("Claude Code ACP session is not initialized.")
    }

    const prompt: ContentBlock[] = [
      {
        type: "text",
        text: trimmedText,
      },
    ]
    const conversation = this.createConversation(trimmedText)

    try {
      const response = await this.connection.prompt({
        sessionId: this.sessionId,
        messageId: conversation.id,
        prompt,
      })
      this.completeConversation(conversation.id, response)

      return response
    } catch (error) {
      this.failConversation(conversation.id, error)
      this.reportError(error)
      throw error
    }
  }

  private async handleSessionUpdate(
    notification: SessionNotification,
  ): Promise<void> {
    this.recordConversationUpdate(notification.update)
    await this.onResponse?.({
      sessionId: notification.sessionId,
      update: notification.update,
    })
  }

  private async handlePermissionRequest(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    try {
      const decision = await this.onPermissionRequest?.(request)

      if (decision) {
        return toPermissionResponse(decision)
      }

      return await new Promise<RequestPermissionResponse>((resolve) => {
        this.pendingPermission = {
          request,
          resolve,
        }
      })
    } catch (error) {
      this.reportError(error)
      return createCancelledPermissionResponse()
    }
  }

  private resolvePermission(
    decision: ClaudeCodeAcpPermissionDecision,
  ): Promise<void> {
    if (!this.pendingPermission) {
      return Promise.reject(
        new Error("No Claude Code ACP permission request is pending."),
      )
    }

    this.pendingPermission.resolve(toPermissionResponse(decision))
    this.pendingPermission = undefined

    return Promise.resolve()
  }

  private reportError(error: unknown): void {
    if (this.onError) {
      this.onError(error)
      return
    }

    throw error
  }

  private createConversation(prompt: string): ClaudeCodeAcpConversation {
    const now = Date.now()
    const conversation: ClaudeCodeAcpConversation = {
      id: randomUUID(),
      sessionId: this.sessionId ?? "",
      prompt,
      updates: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }

    this.conversations.set(conversation.id, conversation)
    this.activeConversationId = conversation.id
    this.emitConversationUpdate(conversation)

    return conversation
  }

  private recordConversationUpdate(update: SessionUpdate): void {
    const conversation = this.findActiveConversation()

    if (!conversation) {
      return
    }

    conversation.updates = [...conversation.updates, update]
    conversation.updatedAt = Date.now()
    this.emitConversationUpdate(conversation)
  }

  private completeConversation(id: string, response: PromptResponse): void {
    const conversation = this.conversations.get(id)

    if (!conversation) {
      return
    }

    const now = Date.now()
    conversation.status = "completed"
    conversation.response = response
    conversation.acknowledgedMessageId = response.userMessageId ?? undefined
    conversation.completedAt = now
    conversation.updatedAt = now

    if (this.activeConversationId === id) {
      this.activeConversationId = this.findLatestPendingConversationId()
    }

    this.emitConversationUpdate(conversation)
  }

  private failConversation(id: string, error: unknown): void {
    const conversation = this.conversations.get(id)

    if (!conversation) {
      return
    }

    const now = Date.now()
    conversation.status = "failed"
    conversation.error = error
    conversation.completedAt = now
    conversation.updatedAt = now

    if (this.activeConversationId === id) {
      this.activeConversationId = this.findLatestPendingConversationId()
    }

    this.emitConversationUpdate(conversation)
  }

  private findActiveConversation(): ClaudeCodeAcpConversation | undefined {
    if (this.activeConversationId) {
      const conversation = this.conversations.get(this.activeConversationId)

      if (conversation?.status === "pending") {
        return conversation
      }
    }

    const id = this.findLatestPendingConversationId()

    return id ? this.conversations.get(id) : undefined
  }

  private findLatestPendingConversationId(): string | undefined {
    return Array.from(this.conversations.values())
      .filter((conversation) => {
        return conversation.status === "pending"
      })
      .sort((left, right) => right.createdAt - left.createdAt)[0]?.id
  }

  private emitConversationUpdate(conversation: ClaudeCodeAcpConversation): void {
    try {
      void Promise.resolve(
        this.onConversationUpdate?.(copyConversation(conversation)),
      ).catch((error: unknown) => {
        this.reportError(error)
      })
    } catch (error) {
      this.reportError(error)
    }
  }
}

const copyConversation = (
  conversation: ClaudeCodeAcpConversation,
): ClaudeCodeAcpConversation => {
  return {
    ...conversation,
    updates: [...conversation.updates],
  }
}

export const initClaudeCodeAcp = (
  options: ClaudeCodeAcpAdapterOptions = {},
): ClaudeCodeAcpAdapter => {
  return new ClaudeCodeAcpAdapter(options)
}
