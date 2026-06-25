package runtime

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/jsonrpc"
)

// startFakeServer wires a jsonrpc server on one end of an in-memory pipe and a
// runtime.Client on the other, so the client is exercised over the real
// protocol without a TS process. Returns the client and the server connection
// (for pushing notifications).
func startFakeServer(t *testing.T, handler jsonrpc.Handler) (*Client, *jsonrpc.Conn) {
	t.Helper()
	clientEnd, serverEnd := net.Pipe()
	t.Cleanup(func() {
		_ = clientEnd.Close()
		_ = serverEnd.Close()
	})
	server := jsonrpc.NewConn(serverEnd, handler)
	return NewClient(clientEnd), server
}

func TestGetConfigRoundTrip(t *testing.T) {
	client, _ := startFakeServer(t, func(method string, _ json.RawMessage) (any, error) {
		if method != MethodGetConfig {
			return nil, &jsonrpc.Error{Code: jsonrpc.MethodNotFound, Message: method}
		}
		return ConfigDTO{Root: "/tmp/requests", AIAdaptor: "claude", Version: "9.9.9"}, nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	cfg, err := client.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if cfg.Root != "/tmp/requests" || cfg.AIAdaptor != "claude" || cfg.Version != "9.9.9" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestExecuteRoundTrip(t *testing.T) {
	client, _ := startFakeServer(t, func(method string, params json.RawMessage) (any, error) {
		if method != MethodExecute {
			return nil, &jsonrpc.Error{Code: jsonrpc.MethodNotFound, Message: method}
		}
		var req ExecuteRequest
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, &jsonrpc.Error{Code: jsonrpc.InvalidParams, Message: err.Error()}
		}
		res := ExecuteResult{Status: 200, StatusText: "OK", DurationMs: 12}
		res.Request.Method = req.Command
		return res, nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	res, err := client.Execute(ctx, ExecuteRequest{Command: "folder/get"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.Status != 200 || res.Request.Method != "folder/get" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestSessionStartedNotificationDispatched(t *testing.T) {
	client, server := startFakeServer(t, func(string, json.RawMessage) (any, error) {
		return nil, nil
	})

	got := make(chan AiSessionStarted, 1)
	client.Subscribe(EventHandlers{
		OnSessionStarted: func(e AiSessionStarted) { got <- e },
	})

	if err := server.Notify(EventSessionStarted, AiSessionStarted{SessionID: "s1", Resumed: true}); err != nil {
		t.Fatalf("Notify: %v", err)
	}

	select {
	case e := <-got:
		if e.SessionID != "s1" || !e.Resumed {
			t.Fatalf("unexpected event: %+v", e)
		}
	case <-time.After(time.Second):
		t.Fatal("did not receive onSessionStarted")
	}
}

func TestSessionErrorNotificationDecodes(t *testing.T) {
	client, server := startFakeServer(t, func(string, json.RawMessage) (any, error) {
		return nil, nil
	})

	got := make(chan error, 1)
	client.Subscribe(EventHandlers{
		OnSessionError: func(err error) { got <- err },
	})

	if err := server.Notify(EventSessionError, SerializedError{Message: "boom", Name: "Error"}); err != nil {
		t.Fatalf("Notify: %v", err)
	}

	select {
	case err := <-got:
		if err.Error() != "boom" {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("did not receive onSessionError")
	}
}
