// Package jsonrpc is a hand-rolled, dependency-free JSON-RPC 2.0 endpoint that
// mirrors the TypeScript implementation in src/runtime/jsonrpc. It speaks the
// same LSP-style Content-Length framing so the Go TUI and the TS runtime can
// talk over a Unix-domain socket. See docs/go-tui-migration-plan.md §4 / §4.1.
package jsonrpc

import "encoding/json"

// Message is a single JSON-RPC frame. The kind is inferred from which fields are
// present, matching the TS side:
//
//	request:      Method set, ID set
//	notification: Method set, ID nil
//	response:     Method empty, ID set, Result or Error set
//
// ID is a raw value so it round-trips numbers or strings unchanged.
type Message struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *Error           `json:"error,omitempty"`
}

// Error is the JSON-RPC error object. It implements the error interface so it
// can be returned directly from Request.
type Error struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *Error) Error() string { return e.Message }

// Reserved range (-32700..-32600) is for protocol-level errors; application
// errors use -32000 and below, discriminated by a `kind` field in Data.
const (
	ParseError     = -32700
	InvalidRequest = -32600
	MethodNotFound = -32601
	InvalidParams  = -32602
	InternalError  = -32603
)

// isResponse reports whether the message is a response (no method) rather than a
// request or notification.
func (m *Message) isResponse() bool { return m.Method == "" }
