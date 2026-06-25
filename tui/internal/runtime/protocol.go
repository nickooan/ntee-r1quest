// Package runtime is the Go client for the ntee-r1quest runtime server: it
// speaks the same JSON-RPC protocol as the TS SocketRuntimeClient
// (src/runtime/client) over a Unix-domain socket. Method/event names and DTOs
// mirror src/runtime/client/protocol.ts and types.ts exactly.
// See docs/go-tui-migration-plan.md §4.
package runtime

// Client → server requests (RecordInput / AiStop are sent as notifications).
const (
	MethodGetConfig           = "getConfig"
	MethodReload              = "reload"
	MethodExecute             = "execute"
	MethodRecordInput         = "recordInput"
	MethodListAiSessions      = "cache/listAiSessions"
	MethodListApiEndpoints    = "cache/listApiEndpoints"
	MethodListTraceCalls      = "cache/listTraceCalls"
	MethodClearCache          = "cache/clear"
	MethodAiStart             = "ai/start"
	MethodAiPrompt            = "ai/prompt"
	MethodAiRespondPermission = "ai/respondPermission"
	MethodAiStop              = "ai/stop"
)

// Server → client notifications.
const (
	EventSessionUpdate      = "event/sessionUpdate"
	EventConversationUpdate = "event/conversationUpdate"
	EventPermissionRequest  = "event/permissionRequest"
	EventSessionStarted     = "event/sessionStarted"
	EventSessionStopped     = "event/sessionStopped"
	EventSessionError       = "event/sessionError"
	EventExternalEvent      = "event/externalEvent"
	EventError              = "event/error"
)
