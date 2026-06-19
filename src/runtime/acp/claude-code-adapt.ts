/**
 * ACP adapter for Claude Code via @agentclientprotocol/claude-agent-acp.
 *
 * Public API intentionally mirrors codex-adapt.ts so callers can switch
 * adapters through getAdaptor without changing session, prompt, permission, or
 * lifecycle handling.
 */
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
import { logAcpDebug } from "./acp-debug.ts"
import {
  AcpConversationManager,
  type AcpConversation,
  type AcpConversationStatus,
} from "./conversation-manager.ts"

export type ClaudeCodeAcpResponse = {
  sessionId: string
  update: SessionUpdate
}

export type ClaudeCodeAcpConversationStatus = AcpConversationStatus

export type ClaudeCodeAcpConversation = AcpConversation

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
  private readonly onPermissionRequest?: ClaudeCodeAcpAdapterOptions["onPermissionRequest"]
  private readonly onError?: ClaudeCodeAcpAdapterOptions["onError"]
  private readonly onExit?: ClaudeCodeAcpAdapterOptions["onExit"]
  private process?: ChildProcessWithoutNullStreams
  private connection?: ClientSideConnection
  private sessionId?: string
  // Permission requests are queued so concurrent requests are surfaced and
  // answered one at a time; `activePermission` is the one shown to the UI.
  private readonly pendingPermissions: PendingPermission[] = []
  private activePermission?: PendingPermission
  private runPromise?: Promise<this>
  private readonly conversationManager: AcpConversationManager
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
    this.onPermissionRequest = options.onPermissionRequest
    this.onError = options.onError
    this.onExit = options.onExit
    this.conversationManager = new AcpConversationManager({
      onConversationUpdate: options.onConversationUpdate,
      onError: (error) => {
        this.reportError(error)
      },
    })
  }

  get isRunning(): boolean {
    return this.process !== undefined && !this.process.killed
  }

  get currentSessionId(): string | undefined {
    return this.sessionId
  }

  get currentPermissionRequest(): ClaudeCodeAcpPermissionRequest | undefined {
    return this.activePermission?.request
  }

  get promptConversations(): ClaudeCodeAcpConversation[] {
    return this.conversationManager.promptConversations
  }

  get unfinishedPromptConversations(): ClaudeCodeAcpConversation[] {
    return this.conversationManager.unfinishedPromptConversations
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

    const cancelled = createCancelledPermissionResponse()

    if (this.activePermission) {
      this.activePermission.resolve(cancelled)
      this.activePermission = undefined
    }

    while (this.pendingPermissions.length > 0) {
      this.pendingPermissions.shift()?.resolve(cancelled)
    }

    this.process?.kill()
    this.process = undefined
    this.connection = undefined
    this.sessionId = undefined
    this.runPromise = undefined
    this.conversationManager.resetActiveConversation()
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
    const conversation = this.conversationManager.createConversation(
      this.sessionId,
      trimmedText,
    )

    logAcpDebug("prompt_sent", { messageId: conversation.id })

    try {
      const response = await this.connection.prompt({
        sessionId: this.sessionId,
        messageId: conversation.id,
        prompt,
      })
      logAcpDebug("prompt_resolved", {
        messageId: conversation.id,
        stopReason: response.stopReason,
      })
      this.conversationManager.completeConversation(conversation.id, response)

      return response
    } catch (error) {
      logAcpDebug("prompt_failed", {
        messageId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      })
      this.conversationManager.failConversation(conversation.id, error)
      this.reportError(error)
      throw error
    }
  }

  private async handleSessionUpdate(
    notification: SessionNotification,
  ): Promise<void> {
    const update = notification.update
    logAcpDebug("session_update", {
      kind: update.sessionUpdate,
      // tool calls carry the status that reveals a background/in-progress turn.
      title: "title" in update ? update.title : undefined,
      status: "status" in update ? update.status : undefined,
    })
    this.conversationManager.recordConversationUpdate(update)
    await this.onResponse?.({
      sessionId: notification.sessionId,
      update,
    })
  }

  private handlePermissionRequest(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    // Queue the request instead of holding a single slot. A second concurrent
    // request used to overwrite the first, orphaning its promise — the agent
    // then waited forever for that reply and the prompt turn never completed
    // (the UI stayed "thinking" even after the response finished).
    logAcpDebug("permission_requested", {
      toolCallId: request.toolCall.toolCallId,
      title: request.toolCall.title,
      queued: this.pendingPermissions.length + (this.activePermission ? 1 : 0),
    })
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissions.push({ request, resolve })

      if (!this.activePermission) {
        void this.activateNextPermission()
      }
    })
  }

  private async activateNextPermission(): Promise<void> {
    const next = this.pendingPermissions.shift()
    this.activePermission = next

    if (!next) {
      return
    }

    let decision: ClaudeCodeAcpPermissionDecision | void

    try {
      decision = await this.onPermissionRequest?.(next.request)
    } catch (error) {
      this.reportError(error)
      decision = { type: "cancelled" }
    }

    // stop() or a user response may have moved past this request while the
    // handler awaited; if so it is already resolved, so leave it alone.
    if (this.activePermission !== next) {
      return
    }

    logAcpDebug("permission_active", {
      toolCallId: next.request.toolCall.toolCallId,
      autoDecided: Boolean(decision),
    })

    // A returned decision is handled immediately; otherwise the request stays
    // active and is resolved later through write() (resolvePermission).
    if (decision) {
      this.activePermission = undefined
      next.resolve(toPermissionResponse(decision))
      void this.activateNextPermission()
    }
  }

  private resolvePermission(
    decision: ClaudeCodeAcpPermissionDecision,
  ): Promise<void> {
    const active = this.activePermission

    if (!active) {
      return Promise.reject(
        new Error("No Claude Code ACP permission request is pending."),
      )
    }

    logAcpDebug("permission_resolved", {
      toolCallId: active.request.toolCall.toolCallId,
      decision: decision.type,
    })
    this.activePermission = undefined
    active.resolve(toPermissionResponse(decision))
    // Surface the next queued request (if any) so it can be answered in turn.
    void this.activateNextPermission()

    return Promise.resolve()
  }

  private reportError(error: unknown): void {
    if (this.onError) {
      this.onError(error)
      return
    }

    throw error
  }
}

export const initClaudeCodeAcp = (
  options: ClaudeCodeAcpAdapterOptions = {},
): ClaudeCodeAcpAdapter => {
  return new ClaudeCodeAcpAdapter(options)
}
