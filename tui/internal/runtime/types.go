package runtime

import "encoding/json"

// CustomCommand mirrors runtime/custom-command CustomCommand.
type CustomCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Instruction string `json:"instruction"`
}

// ConfigDTO mirrors RuntimeConfigDto.
type ConfigDTO struct {
	Root                string          `json:"root"`
	AIAdaptor           string          `json:"aiAdaptor,omitempty"`
	CustomCommands      []CustomCommand `json:"customCommands"`
	CustomSuggestions   []string        `json:"customSuggestions"`
	ExternalEventSocket string          `json:"externalEventSocket,omitempty"`
	Version             string          `json:"version"`
}

// ExecuteRequest mirrors ExecuteRequest.
type ExecuteRequest struct {
	Command string `json:"command"`
	Env     string `json:"env,omitempty"`
	TraceID string `json:"traceId,omitempty"`
}

// ExecuteResult mirrors ExecuteResult: everything formatResponse reads.
type ExecuteResult struct {
	Request struct {
		Method  string `json:"method,omitempty"`
		URL     string `json:"url,omitempty"`
		BaseURL string `json:"baseURL,omitempty"`
	} `json:"request"`
	Status     int             `json:"status"`
	StatusText string          `json:"statusText"`
	Headers    map[string]any  `json:"headers"`
	Body       json.RawMessage `json:"body,omitempty"`
	DurationMs int64           `json:"durationMs"`
	// Joint chain runs only: shared trace id, executed step count, and — when
	// the chain stopped on a failing step that still returned a response — that
	// step's label, e.g. "2/3 (query-user-posts)".
	TraceID    string `json:"traceId,omitempty"`
	StepCount  int    `json:"stepCount,omitempty"`
	FailedStep string `json:"failedStep,omitempty"`
}

// AiStartRequest mirrors AiStartRequest.
type AiStartRequest struct {
	Adaptor         string `json:"adaptor"`
	ResumeSessionID string `json:"resumeSessionId,omitempty"`
}

// AiPromptFileRef mirrors client AiPromptFileRef: a file/directory attached to
// an AI prompt, sent as an ACP resource_link content block (name + absolute
// path) rather than inlined into the message text.
type AiPromptFileRef struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// AiPermissionDecision mirrors AiPermissionDecision.
type AiPermissionDecision struct {
	Type     string `json:"type"`
	OptionID string `json:"optionId,omitempty"`
}

// AiSessionUpdate mirrors AiSessionUpdate; Update is the ACP SessionUpdate JSON,
// kept raw for the renderer to interpret.
type AiSessionUpdate struct {
	SessionID string          `json:"sessionId"`
	Update    json.RawMessage `json:"update"`
}

// AiSessionStarted mirrors AiSessionStarted.
type AiSessionStarted struct {
	SessionID string `json:"sessionId,omitempty"`
	Resumed   bool   `json:"resumed"`
	// Whether the adapter accepts ai/prompt while a turn is running (true
	// steering, e.g. Claude). False → the TUI queues mid-turn messages.
	SupportsSteering bool `json:"supportsSteering"`
}

// SerializedError mirrors the wire shape of an error (message + name).
type SerializedError struct {
	Message string `json:"message"`
	Name    string `json:"name,omitempty"`
}

func (e SerializedError) Error() string { return e.Message }

// AiSessionStopped mirrors AiSessionStopped (error optional).
type AiSessionStopped struct {
	Error *SerializedError `json:"error,omitempty"`
}

// AiSessionRecord mirrors cache AiSessionRecord.
type AiSessionRecord struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// ApiCallRecord mirrors cache ApiCallRecord (history entries).
type ApiCallRecord struct {
	Endpoint   string `json:"endpoint"`
	Path       string `json:"path"`
	Method     string `json:"method"`
	TraceID    string `json:"traceId,omitempty"`
	At         int64  `json:"at"`
	DurationMs int64  `json:"durationMs"`
	Request    struct {
		URL     string          `json:"url,omitempty"`
		Method  string          `json:"method,omitempty"`
		Headers map[string]any  `json:"headers"`
		Body    json.RawMessage `json:"body,omitempty"`
	} `json:"request"`
	Response struct {
		Status  int             `json:"status"`
		Headers map[string]any  `json:"headers"`
		Data    json.RawMessage `json:"data"`
	} `json:"response"`
}

// SnapshotRecord mirrors cache SnapshotRecord (one file-version snapshot).
type SnapshotRecord struct {
	Filename   string `json:"filename"`
	Path       string `json:"path"`
	Seq        int64  `json:"seq"`
	SnapshotAt string `json:"snapshotAt"`
	Kind       string `json:"kind"`
	Content    string `json:"content"`
}

// SnapshotMeta mirrors cache SnapshotMeta (lightweight snapshot metadata).
type SnapshotMeta struct {
	Seq        int64  `json:"seq"`
	SnapshotAt string `json:"snapshotAt"`
	Kind       string `json:"kind"`
}

// ExternalRequestEvent mirrors external-event ExternalRequestEvent.
type ExternalRequestEvent struct {
	NtsPath         string `json:"ntsPath"`
	NtsFile         string `json:"ntsFile"`
	Time            int64  `json:"time"`
	ResponseContent string `json:"responseContent"`
	TraceID         string `json:"traceId,omitempty"`
	// A non-final step of a joint chain: persisted to history by the runtime,
	// but the results pane only shows the chain's final response.
	Intermediate bool `json:"intermediate,omitempty"`
}

// EventHandlers are the server→client notification callbacks (nil = ignore).
// Mirrors RuntimeEventHandlers. Permission requests and conversations are raw
// JSON, interpreted by the renderer.
type EventHandlers struct {
	OnSessionUpdate      func(AiSessionUpdate)
	OnConversationUpdate func(json.RawMessage)
	OnPermissionRequest  func(json.RawMessage)
	OnSessionStarted     func(AiSessionStarted)
	OnSessionStopped     func(AiSessionStopped)
	OnSessionError       func(error)
	OnExternalEvent      func(ExternalRequestEvent)
	OnError              func(error)
}
