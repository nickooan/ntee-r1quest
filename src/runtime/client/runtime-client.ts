// The RuntimeClient contract: the single seam the view layer uses to reach the
// anchor-side runtime (parse/execute, cache, AI/ACP, config, external events).
// One in-process implementation today; a JSON-RPC socket implementation later.
// Both honor this interface, so the view layer never changes when the transport
// does. See docs/go-tui-migration-plan.md §4 / §5.
//
// Scope note: this surface is ANCHOR-side only. Go-local concerns
// (file-manager, editor-suggestions, clipboard, app-command, custom-command)
// are NOT here — they are ported to Go directly and never cross the seam.

import type { AcpAdaptorName } from "../acp/index.ts"
import type { AiSessionRecord, ApiCallRecord } from "../cache/index.ts"
import type { ExternalRequestEvent } from "../external-event/index.ts"
import type {
  AiConversation,
  AiPermissionDecision,
  AiPermissionRequest,
  AiSessionStarted,
  AiSessionStopped,
  AiSessionUpdate,
  AiStartRequest,
  ExecuteRequest,
  ExecuteResult,
  RuntimeConfigDto,
} from "./types.ts"

// Server→client messages, all notifications. The runtime pushes AI session
// lifecycle/stream/permission updates and external events. Handlers are
// registered via `RuntimeClient.subscribe`. The permission request is delivered
// here; the answer goes back through `AiClient.respondPermission`.
export type RuntimeEventHandlers = {
  onSessionUpdate?: (event: AiSessionUpdate) => void
  onConversationUpdate?: (conversation: AiConversation) => void
  onPermissionRequest?: (request: AiPermissionRequest) => void
  onSessionStarted?: (event: AiSessionStarted) => void
  onSessionStopped?: (event: AiSessionStopped) => void
  // Non-fatal AI errors (the session may continue).
  onSessionError?: (error: unknown) => void
  onExternalEvent?: (event: ExternalRequestEvent) => void
  // Best-effort runtime errors that have no request to reject (e.g. the
  // external-event listener failing). Surfaced as a UI banner today.
  onError?: (error: unknown) => void
}

// AI/ACP turn control. Replies and lifecycle arrive via the event handlers;
// `start`/`prompt` resolve once the action is dispatched, not when the reply
// completes. Only one session is active at a time.
export type AiClient = {
  start(request: AiStartRequest): Promise<void>
  prompt(text: string): Promise<void>
  respondPermission(decision: AiPermissionDecision): Promise<void>
  stop(): void
}

export interface RuntimeClient {
  // Config / lifecycle.
  getConfig(): Promise<RuntimeConfigDto>
  reload(): Promise<RuntimeConfigDto>

  // Request execution. Resolves for any received response (incl. non-2xx);
  // rejects only when no response came back (see ExecuteResult docs).
  execute(request: ExecuteRequest): Promise<ExecuteResult>

  // Cache. `recordInput` is fire-and-forget (best-effort, no ack).
  recordInput(command: string): void
  listAiSessions(adaptor: AcpAdaptorName): Promise<AiSessionRecord[]>
  listApiEndpoints(): Promise<ApiCallRecord[]>
  listTraceCalls(traceId: string): Promise<ApiCallRecord[]>
  clearCache(): Promise<void>

  // AI/ACP. Session bookkeeping (add/refresh records) is internal to the
  // runtime, triggered by start/resume — not exposed here.
  readonly ai: AiClient

  // Register handlers for server→client messages; returns an unsubscribe fn.
  subscribe(handlers: RuntimeEventHandlers): () => void

  // Release resources (sockets, listeners, adapters). Idempotent.
  close(): void
}
