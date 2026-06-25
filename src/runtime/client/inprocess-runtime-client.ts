// In-process implementation of RuntimeClient: a thin facade over the existing
// runtime functions, no behavior change. The view layer talks to this today; a
// JSON-RPC socket implementation replaces it later (plan §5, Phase A/C). This
// orchestration (execute, cache, AI adapter lifecycle) is the durable half — it
// becomes the runtime server behind the socket; the view/hook is throwaway.

import { isAxiosError, type AxiosResponse } from "axios"
import {
  getAdaptor,
  resolveAdaptorName,
  type AcpAdaptorName,
  type CodexAcpAdapterOptions,
  type CodexAcpWriteInput,
} from "../acp/index.ts"
import {
  addAiSession,
  clearCache as clearCacheEntries,
  listAiSessions as listAiSessionsFromCache,
  listApiEndpoints as listApiEndpointsFromCache,
  listTraceCalls as listTraceCallsFromCache,
  recordInput as recordInputToCache,
  refreshAiSession,
  type AiSessionRecord,
  type ApiCallRecord,
} from "../cache/index.ts"
import { execute, resolveRuntimeConfig } from "../cli-command.ts"
import { clearRuntimeConfigCache, type RuntimeConfig } from "../config.ts"
import {
  startExternalEventListener,
  type ExternalEventListener,
} from "../external-event/index.ts"
import { VERSION } from "../version.ts"
import type {
  AiClient,
  RuntimeClient,
  RuntimeEventHandlers,
} from "./runtime-client.ts"
import type {
  AiPermissionDecision,
  AiStartRequest,
  ExecuteRequest,
  ExecuteResult,
  RuntimeConfigDto,
} from "./types.ts"

// The slice of an ACP adapter the client drives. Adapters are created through a
// factory so tests can inject a fake and exercise the orchestration without
// spawning a real agent.
export type AcpAdapterInstance = {
  // Adapters resolve run() with themselves; the client only awaits readiness.
  run(): Promise<unknown>
  write(input: CodexAcpWriteInput): Promise<void>
  stop(): void
  readonly currentSessionId: string | undefined
}

export type AcpAdapterFactory = (
  adaptor: AcpAdaptorName,
  options: CodexAcpAdapterOptions,
) => AcpAdapterInstance

const defaultAdapterFactory: AcpAdapterFactory = (adaptor, options) => {
  const Adaptor = getAdaptor(adaptor)
  return new Adaptor(options) as AcpAdapterInstance
}

export class InProcessRuntimeClient implements RuntimeClient {
  private config: RuntimeConfig
  private handlers: RuntimeEventHandlers = {}
  private externalListener: ExternalEventListener | undefined
  private closed = false
  // The single live AI adapter and whether it has finished starting. `ready`
  // distinguishes a startup failure (tear down) from a mid-session error.
  private currentAdapter: AcpAdapterInstance | undefined
  private adapterReady = false

  // `args` reproduces the CLI invocation so `reload` can re-resolve config from
  // disk exactly like CommandApp does today. `adapterFactory` is injectable so
  // tests can drive a fake adapter.
  constructor(
    private readonly args: string[],
    config: RuntimeConfig,
    private readonly adapterFactory: AcpAdapterFactory = defaultAdapterFactory,
  ) {
    this.config = config
  }

  async getConfig(): Promise<RuntimeConfigDto> {
    return this.toConfigDto(this.config)
  }

  async reload(): Promise<RuntimeConfigDto> {
    clearRuntimeConfigCache()
    this.config = resolveRuntimeConfig(this.args)
    // Re-resolving config can change the external-event socket; rebind it.
    await this.stopExternalListener()
    this.startExternalListener()
    return this.toConfigDto(this.config)
  }

  // Resolves with an ExecuteResult for any received response — including non-2xx,
  // which axios surfaces as a thrown AxiosError carrying `.response`. Rejects
  // only when no response came back (network/runtime failure). See ExecuteResult.
  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const startedAt = Date.now()

    try {
      const response = await execute(
        request.command,
        this.config.root,
        request.traceId,
        request.env ?? this.config.parsedArgs.env,
      )
      return toExecuteResult(response, Date.now() - startedAt)
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        return toExecuteResult(error.response, Date.now() - startedAt)
      }
      throw error
    }
  }

  recordInput(command: string): void {
    recordInputToCache(command)
  }

  async listAiSessions(adaptor: AcpAdaptorName): Promise<AiSessionRecord[]> {
    return listAiSessionsFromCache(adaptor)
  }

  async listApiEndpoints(): Promise<ApiCallRecord[]> {
    return listApiEndpointsFromCache()
  }

  async listTraceCalls(traceId: string): Promise<ApiCallRecord[]> {
    return listTraceCallsFromCache(traceId)
  }

  async clearCache(): Promise<void> {
    await clearCacheEntries()
  }

  readonly ai: AiClient = {
    start: (request) => this.startAi(request),
    prompt: (text) => this.promptAi(text),
    respondPermission: (decision) => this.respondPermission(decision),
    stop: () => this.stopAi(),
  }

  // Spawns the adapter, fans its callbacks out as events, and on ready records
  // the session in the cache. Lifts the adapter half of the old ai-controller;
  // the `currentAdapter !== adapter` guards drop late callbacks from a replaced
  // adapter, exactly as the old `aiAdapterRef` guards did.
  private async startAi({
    adaptor,
    resumeSessionId,
  }: AiStartRequest): Promise<void> {
    // Re-entering @ai with a live adapter reuses it; the view just reopens.
    if (this.currentAdapter) {
      return
    }

    this.adapterReady = false

    const adapter = this.adapterFactory(adaptor, {
      cwd: this.config.root,
      sessionId: resumeSessionId,
      onResponse: (response) => {
        if (this.currentAdapter !== adapter) return
        this.handlers.onSessionUpdate?.(response)
      },
      onConversationUpdate: (conversation) => {
        if (this.currentAdapter !== adapter) return
        this.handlers.onConversationUpdate?.(conversation)
      },
      onPermissionRequest: (request) => {
        if (this.currentAdapter !== adapter) return
        this.handlers.onPermissionRequest?.(request)
      },
      onError: (error) => {
        if (this.currentAdapter !== adapter) return
        this.handlers.onSessionError?.(error)

        // A failure before ready is fatal for this session; tear it down.
        if (!this.adapterReady) {
          this.currentAdapter = undefined
          adapter.stop()
          this.handlers.onSessionStopped?.({ error })
        }
      },
      onExit: () => {
        if (this.currentAdapter !== adapter) return
        this.currentAdapter = undefined
        this.handlers.onSessionStopped?.({})
      },
    })

    this.currentAdapter = adapter

    try {
      await adapter.run()

      if (this.currentAdapter !== adapter) {
        return
      }

      this.adapterReady = true

      // Reconcile the session in the cache: record a new one, or bump a resumed
      // one so startup cleanup keeps it.
      const sessionId = adapter.currentSessionId

      if (sessionId) {
        const isKnown = listAiSessionsFromCache(adaptor).some(
          (session) => session.id === sessionId,
        )

        void (isKnown
          ? refreshAiSession(adaptor, sessionId)
          : addAiSession(adaptor, sessionId))
      }

      this.handlers.onSessionStarted?.({
        sessionId,
        resumed: Boolean(resumeSessionId),
      })
    } catch (error) {
      if (this.currentAdapter !== adapter) {
        return
      }

      this.currentAdapter = undefined
      adapter.stop()
      this.handlers.onSessionStopped?.({ error })
    }
  }

  private async promptAi(text: string): Promise<void> {
    await this.currentAdapter?.write(text)
  }

  private async respondPermission(
    decision: AiPermissionDecision,
  ): Promise<void> {
    await this.currentAdapter?.write({ type: "permission", decision })
  }

  private stopAi(): void {
    const adapter = this.currentAdapter
    this.currentAdapter = undefined
    this.adapterReady = false
    adapter?.stop()
  }

  subscribe(handlers: RuntimeEventHandlers): () => void {
    this.handlers = handlers
    this.startExternalListener()

    return () => {
      if (this.handlers === handlers) {
        this.handlers = {}
      }
      void this.stopExternalListener()
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopAi()
    this.handlers = {}
    void this.stopExternalListener()
  }

  private startExternalListener(): void {
    const socketPath = this.config.sock

    if (!socketPath || this.externalListener || this.closed) {
      return
    }

    try {
      this.externalListener = startExternalEventListener(
        socketPath,
        (event) => this.handlers.onExternalEvent?.(event),
        (error) => this.handlers.onError?.(error),
      )
    } catch (error) {
      this.handlers.onError?.(error)
    }
  }

  private async stopExternalListener(): Promise<void> {
    const listener = this.externalListener
    this.externalListener = undefined
    await listener?.close()
  }

  private toConfigDto(config: RuntimeConfig): RuntimeConfigDto {
    return toRuntimeConfigDto(config)
  }
}

// Pure RuntimeConfig → DTO mapping, also used by the entry point to derive the
// initial config snapshot synchronously (without an async getConfig on mount).
export const toRuntimeConfigDto = (
  config: RuntimeConfig,
): RuntimeConfigDto => ({
  root: config.root,
  aiAdaptor: config.ai ? resolveAdaptorName(config.ai) : undefined,
  customCommands: config.customCommands,
  customSuggestions: config.customSuggestions,
  externalEventSocket: config.sock,
  version: VERSION,
})

// Maps an axios response to the serializable ExecuteResult, carrying the request
// fields `formatResponse` reads (method/url/baseURL) alongside status/headers/body.
export const toExecuteResult = (
  response: AxiosResponse,
  durationMs: number,
): ExecuteResult => ({
  request: {
    method: response.config.method,
    url: response.config.url,
    baseURL: response.config.baseURL,
  },
  status: response.status,
  statusText: response.statusText,
  headers: response.headers as Record<string, unknown>,
  body: response.data,
  durationMs,
})
