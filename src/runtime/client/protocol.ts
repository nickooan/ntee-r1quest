// The wire contract shared by SocketRuntimeServer and SocketRuntimeClient: the
// JSON-RPC method/event names and error (de)serialization. Keeping the names in
// one place stops the two sides from drifting. The Go client mirrors these.
// See docs/go-tui-migration-plan.md §4.

// Client → server requests (and one fire-and-forget notification, recordInput).
export const RpcMethod = {
  GetConfig: "getConfig",
  Reload: "reload",
  Execute: "execute",
  RecordInput: "recordInput",
  ListAiSessions: "cache/listAiSessions",
  ListApiEndpoints: "cache/listApiEndpoints",
  ListTraceCalls: "cache/listTraceCalls",
  ClearCache: "cache/clear",
  AiStart: "ai/start",
  AiPrompt: "ai/prompt",
  AiRespondPermission: "ai/respondPermission",
  AiStop: "ai/stop",
} as const

// Server → client notifications.
export const RpcEvent = {
  SessionUpdate: "event/sessionUpdate",
  ConversationUpdate: "event/conversationUpdate",
  PermissionRequest: "event/permissionRequest",
  SessionStarted: "event/sessionStarted",
  SessionStopped: "event/sessionStopped",
  SessionError: "event/sessionError",
  ExternalEvent: "event/externalEvent",
  Error: "event/error",
} as const

// Errors can't cross JSON as Error instances; carry the message (and name) and
// rebuild an Error on the far side.
export type SerializedError = { message: string; name?: string }

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return { message: error.message, name: error.name }
  }
  return { message: String(error) }
}

export const deserializeError = (value: SerializedError): Error => {
  const error = new Error(value.message)
  if (value.name) {
    error.name = value.name
  }
  return error
}
