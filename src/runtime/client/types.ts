// DTOs for the RuntimeClient contract (plan §4). Every shape here is
// JSON-serializable so the same types flow through the in-process facade today
// and the JSON-RPC socket later. These are mirrored by Go structs in the TUI.

import type { AcpAdaptorName } from "../acp/index.ts"
import type { CustomCommand } from "../custom-command/index.ts"

// ── Config ───────────────────────────────────────────────────────────────────

// The startup handshake / reload payload. Mirrors what `index.ts` derives from
// RuntimeConfig today (root, resolved adaptor, custom commands/suggestions,
// external-event socket, version).
export type RuntimeConfigDto = {
  root: string
  aiAdaptor?: AcpAdaptorName
  customCommands: CustomCommand[]
  customSuggestions: string[]
  externalEventSocket?: string
  version: string
}

// ── Execute ──────────────────────────────────────────────────────────────────

export type ExecuteRequest = {
  // The request source, e.g. "folder/get-orders" (".nts" optional).
  command: string
  // JSON object string from the `-env` flag, merged over process.env for macros.
  env?: string
  // Optional batch/task id; echoed back for display and trace grouping.
  traceId?: string
}

// A serializable view of an HTTP response, carrying everything `formatResponse`
// reads (request method/url/baseURL + status/headers/body) plus timing.
//
// Contract: `execute` RESOLVES with this whenever a response was received —
// including non-2xx statuses — and REJECTS (RpcError) only when no response came
// back at all (network/runtime failure). This replaces the current behavior
// where axios throws on non-2xx; the failed-response recording already exists in
// `cli-command.ts`, so the runtime has the data to honor this.
export type ExecuteResult = {
  request: {
    method?: string
    url?: string
    baseURL?: string
  }
  status: number
  statusText: string
  headers: Record<string, unknown>
  body: unknown
  durationMs: number
}

// ── AI / ACP ───────────────────────────────────────────────────────────────

// Starts (or, with resumeSessionId, resumes) an agent session. The reply and
// lifecycle arrive as events (onSessionUpdate / onSessionStarted / ...); start
// resolves once the adapter has been kicked off, not when the turn completes.
export type AiStartRequest = {
  adaptor: AcpAdaptorName
  resumeSessionId?: string
}

// Streamed reply for an active turn. `update` is an ACP `SessionUpdate` passed
// through verbatim (opaque to the contract; the runtime produces it, Go renders
// it). Typed as unknown so the contract stays free of the ACP SDK.
export type AiSessionUpdate = {
  sessionId: string
  update: unknown
}

// A tool-use approval request the runtime emits mid-turn. The UI renders it and
// answers later via `ai.respondPermission`. `toolCall`/`options` are passed
// through opaquely (the view interprets them; Go will redefine from the wire).
export type AiPermissionRequest = unknown

export type AiPermissionDecision =
  | { type: "selected"; optionId: string }
  | { type: "cancelled" }

// Conversation list entry, passed through opaquely.
export type AiConversation = unknown

// Emitted once the adapter is ready (resumed = true when an existing session was
// loaded, so the UI can add a history divider).
export type AiSessionStarted = { sessionId?: string; resumed: boolean }

// Emitted when the session ends (agent exit, startup failure). `error` is set
// for failures so the UI can surface it.
export type AiSessionStopped = { error?: unknown }
