/**
 * Example:
 *
 * const codex = initCodexAcp({
 *   cwd: process.cwd(),
 *   env: {
 *     OPENAI_API_KEY: process.env.OPENAI_API_KEY,
 *   },
 *   onResponse: ({ update }) => {
 *     // handle agent_message_chunk, tool_call, plan, etc.
 *   },
 *   onPermissionRequest: (request) => {
 *     // return a decision immediately, or return void and answer later via write()
 *   },
 *   onError: (error) => {
 *     // surface in UI
 *   },
 * })
 *
 * await codex.run()
 * await codex.write("help me inspect this request")
 * await codex.write({
 *   type: "permission",
 *   decision: {
 *     type: "selected",
 *     optionId: "approved",
 *   },
 * })
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

export type CodexAcpResponse = {
  sessionId: string
  update: SessionUpdate
}

export type CodexAcpPermissionRequest = RequestPermissionRequest

export type CodexAcpPermissionDecision =
  | {
      type: "selected"
      optionId: string
    }
  | {
      type: "cancelled"
    }

export type CodexAcpWriteInput =
  | string
  | {
      type: "prompt"
      text: string
    }
  | {
      type: "permission"
      decision: CodexAcpPermissionDecision
    }

export type CodexAcpAdapterOptions = {
  cwd?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  clientName?: string
  clientVersion?: string
  onResponse?: (response: CodexAcpResponse) => void | Promise<void>
  onPermissionRequest?: (
    request: CodexAcpPermissionRequest,
  ) =>
    | CodexAcpPermissionDecision
    | void
    | Promise<CodexAcpPermissionDecision | void>
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
  decision: CodexAcpPermissionDecision,
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

export class CodexAcpAdapter {
  private readonly cwd: string
  private readonly args: string[]
  private readonly env: NodeJS.ProcessEnv
  private readonly clientName: string
  private readonly clientVersion: string
  private readonly onResponse?: CodexAcpAdapterOptions["onResponse"]
  private readonly onPermissionRequest?: CodexAcpAdapterOptions["onPermissionRequest"]
  private readonly onError?: CodexAcpAdapterOptions["onError"]
  private readonly onExit?: CodexAcpAdapterOptions["onExit"]
  private process?: ChildProcessWithoutNullStreams
  private connection?: ClientSideConnection
  private sessionId?: string
  private pendingPermission?: PendingPermission
  private promptQueue: Promise<PromptResponse | void> = Promise.resolve()
  private isStopping = false

  constructor(options: CodexAcpAdapterOptions = {}) {
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
  }

  get isRunning(): boolean {
    return this.process !== undefined && !this.process.killed
  }

  get currentSessionId(): string | undefined {
    return this.sessionId
  }

  get currentPermissionRequest(): CodexAcpPermissionRequest | undefined {
    return this.pendingPermission?.request
  }

  async run(): Promise<this> {
    if (this.connection && this.sessionId) {
      return this
    }

    const codexAcpPath = fileURLToPath(
      import.meta.resolve("@zed-industries/codex-acp/bin/codex-acp.js"),
    )
    const childProcess = spawn(process.execPath, [codexAcpPath, ...this.args], {
      cwd: this.cwd,
      env: this.env,
      stdio: "pipe",
    })

    this.isStopping = false
    this.process = childProcess
    childProcess.once("error", (error) => {
      this.reportError(error)
    })
    childProcess.once("exit", (code, signal) => {
      if (!this.isStopping && code !== 0) {
        this.reportError(
          new Error(
            `Codex ACP exited${code === null ? "" : ` with code ${code}`}${
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

  async write(input: CodexAcpWriteInput): Promise<PromptResponse | void> {
    if (typeof input === "string") {
      return this.enqueuePrompt(input)
    }

    if (input.type === "prompt") {
      return this.enqueuePrompt(input.text)
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
  }

  private enqueuePrompt(text: string): Promise<PromptResponse | void> {
    this.promptQueue = this.promptQueue
      .catch(() => undefined)
      .then(() => {
        return this.sendPrompt(text)
      })

    return this.promptQueue
  }

  private async sendPrompt(text: string): Promise<PromptResponse> {
    const trimmedText = text.trim()

    if (!trimmedText) {
      throw new Error("Cannot send an empty prompt to Codex ACP.")
    }

    if (!this.connection || !this.sessionId) {
      await this.run()
    }

    if (!this.connection || !this.sessionId) {
      throw new Error("Codex ACP session is not initialized.")
    }

    const prompt: ContentBlock[] = [
      {
        type: "text",
        text: trimmedText,
      },
    ]

    try {
      return await this.connection.prompt({
        sessionId: this.sessionId,
        prompt,
      })
    } catch (error) {
      this.reportError(error)
      throw error
    }
  }

  private async handleSessionUpdate(
    notification: SessionNotification,
  ): Promise<void> {
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
    decision: CodexAcpPermissionDecision,
  ): Promise<void> {
    if (!this.pendingPermission) {
      return Promise.reject(
        new Error("No Codex ACP permission request is pending."),
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
}

export const initCodexAcp = (
  options: CodexAcpAdapterOptions = {},
): CodexAcpAdapter => {
  return new CodexAcpAdapter(options)
}
