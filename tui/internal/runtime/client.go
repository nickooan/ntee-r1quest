package runtime

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"sync"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/jsonrpc"
)

// Client is the Go RuntimeClient: it issues protocol method calls over JSON-RPC
// and routes server notifications to the subscribed EventHandlers. It is the
// production equivalent of the TS SocketRuntimeClient.
type Client struct {
	conn *jsonrpc.Conn

	mu       sync.Mutex
	handlers EventHandlers
}

// NewClient wraps an established duplex stream (a UDS connection, or an
// in-memory pipe in tests).
func NewClient(rwc io.ReadWriteCloser) *Client {
	c := &Client{}
	c.conn = jsonrpc.NewConn(rwc, c.handle)
	return c
}

// Connect dials the runtime server's Unix-domain socket.
func Connect(socketPath string) (*Client, error) {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, err
	}
	return NewClient(conn), nil
}

// Subscribe registers the server→client event handlers, returning an unsubscribe
// function.
func (c *Client) Subscribe(handlers EventHandlers) func() {
	c.mu.Lock()
	c.handlers = handlers
	c.mu.Unlock()

	return func() {
		c.mu.Lock()
		c.handlers = EventHandlers{}
		c.mu.Unlock()
	}
}

// Close shuts the connection.
func (c *Client) Close() error { return c.conn.Close() }

func (c *Client) GetConfig(ctx context.Context) (ConfigDTO, error) {
	return request[ConfigDTO](ctx, c, MethodGetConfig, nil)
}

func (c *Client) Reload(ctx context.Context) (ConfigDTO, error) {
	return request[ConfigDTO](ctx, c, MethodReload, nil)
}

func (c *Client) Execute(ctx context.Context, req ExecuteRequest) (ExecuteResult, error) {
	return request[ExecuteResult](ctx, c, MethodExecute, req)
}

func (c *Client) RecordInput(command string) error {
	return c.conn.Notify(MethodRecordInput, map[string]string{"command": command})
}

func (c *Client) SuggestInputs(ctx context.Context, prefix string, limit int) ([]string, error) {
	return request[[]string](ctx, c, MethodSuggestInputs, map[string]any{"prefix": prefix, "limit": limit})
}

func (c *Client) ListAiSessions(ctx context.Context, adaptor string) ([]AiSessionRecord, error) {
	return request[[]AiSessionRecord](ctx, c, MethodListAiSessions, map[string]string{"adaptor": adaptor})
}

func (c *Client) ListApiEndpoints(ctx context.Context) ([]ApiCallRecord, error) {
	return request[[]ApiCallRecord](ctx, c, MethodListApiEndpoints, nil)
}

func (c *Client) ListTraceCalls(ctx context.Context, traceID string) ([]ApiCallRecord, error) {
	return request[[]ApiCallRecord](ctx, c, MethodListTraceCalls, map[string]string{"traceId": traceID})
}

func (c *Client) ClearCache(ctx context.Context) error {
	_, err := c.conn.Request(ctx, MethodClearCache, nil)
	return err
}

// SnapshotPut records a file-version snapshot (fire-and-forget notification).
func (c *Client) SnapshotPut(path string, seq int64, kind, content string) error {
	return c.conn.Notify(MethodSnapshotPut, map[string]any{
		"path": path, "seq": seq, "kind": kind, "content": content,
	})
}

// SnapshotGet returns one snapshot by seq; ok is false when it's absent/evicted.
func (c *Client) SnapshotGet(ctx context.Context, seq int64) (SnapshotRecord, bool, error) {
	rec, err := request[*SnapshotRecord](ctx, c, MethodSnapshotGet, map[string]any{"seq": seq})
	if err != nil || rec == nil {
		return SnapshotRecord{}, false, err
	}
	return *rec, true, nil
}

// SnapshotList returns up to limit snapshots for a file, newest first.
func (c *Client) SnapshotList(ctx context.Context, path string, limit int) ([]SnapshotMeta, error) {
	return request[[]SnapshotMeta](ctx, c, MethodSnapshotList, map[string]any{"path": path, "limit": limit})
}

// SnapshotDelete removes snapshots by seq (fire-and-forget notification).
func (c *Client) SnapshotDelete(seqs []int64) error {
	return c.conn.Notify(MethodSnapshotDelete, map[string]any{"seqs": seqs})
}

func (c *Client) AiStart(ctx context.Context, req AiStartRequest) error {
	_, err := c.conn.Request(ctx, MethodAiStart, req)
	return err
}

func (c *Client) AiPrompt(ctx context.Context, text string) error {
	_, err := c.conn.Request(ctx, MethodAiPrompt, map[string]string{"text": text})
	return err
}

func (c *Client) AiRespondPermission(ctx context.Context, decision AiPermissionDecision) error {
	_, err := c.conn.Request(ctx, MethodAiRespondPermission, decision)
	return err
}

func (c *Client) AiStop() error { return c.conn.Notify(MethodAiStop, nil) }

// request issues a typed request: marshal params, await the response, unmarshal.
func request[T any](ctx context.Context, c *Client, method string, params any) (T, error) {
	var result T

	raw, err := c.conn.Request(ctx, method, params)
	if err != nil {
		return result, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return result, nil
	}

	err = json.Unmarshal(raw, &result)
	return result, err
}

// handle dispatches an inbound server notification to the subscribed handlers.
func (c *Client) handle(method string, params json.RawMessage) (any, error) {
	c.mu.Lock()
	h := c.handlers
	c.mu.Unlock()

	switch method {
	case EventSessionUpdate:
		if h.OnSessionUpdate != nil {
			var e AiSessionUpdate
			if json.Unmarshal(params, &e) == nil {
				h.OnSessionUpdate(e)
			}
		}
	case EventConversationUpdate:
		if h.OnConversationUpdate != nil {
			h.OnConversationUpdate(params)
		}
	case EventPermissionRequest:
		if h.OnPermissionRequest != nil {
			h.OnPermissionRequest(params)
		}
	case EventSessionStarted:
		if h.OnSessionStarted != nil {
			var e AiSessionStarted
			if json.Unmarshal(params, &e) == nil {
				h.OnSessionStarted(e)
			}
		}
	case EventSessionStopped:
		if h.OnSessionStopped != nil {
			var e AiSessionStopped
			if json.Unmarshal(params, &e) == nil {
				h.OnSessionStopped(e)
			}
		}
	case EventSessionError:
		if h.OnSessionError != nil {
			h.OnSessionError(decodeError(params))
		}
	case EventExternalEvent:
		if h.OnExternalEvent != nil {
			var e ExternalRequestEvent
			if json.Unmarshal(params, &e) == nil {
				h.OnExternalEvent(e)
			}
		}
	case EventError:
		if h.OnError != nil {
			h.OnError(decodeError(params))
		}
	}

	// Notifications expect no response.
	return nil, nil
}

func decodeError(params json.RawMessage) error {
	var se SerializedError
	if err := json.Unmarshal(params, &se); err != nil || se.Message == "" {
		return SerializedError{Message: "unknown runtime error"}
	}
	return se
}
