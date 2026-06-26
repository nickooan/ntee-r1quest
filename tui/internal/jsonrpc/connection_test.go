package jsonrpc

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"
)

func TestNotificationsArriveInOrder(t *testing.T) {
	clientRW, serverRW := newPair(t)

	const n = 200
	got := make(chan int, n)
	NewConn(serverRW, func(_ string, params json.RawMessage) (any, error) {
		var i int
		_ = json.Unmarshal(params, &i)
		got <- i
		return nil, nil
	})

	client := NewConn(clientRW, nil)
	for i := 0; i < n; i++ {
		if err := client.Notify("seq", i); err != nil {
			t.Fatalf("notify %d: %v", i, err)
		}
	}

	for i := 0; i < n; i++ {
		select {
		case v := <-got:
			if v != i {
				t.Fatalf("notification out of order: want %d, got %d", i, v)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for notification %d", i)
		}
	}
}

func newPair(t *testing.T) (clientRW, serverRW net.Conn) {
	t.Helper()
	clientRW, serverRW = net.Pipe()
	t.Cleanup(func() {
		_ = clientRW.Close()
		_ = serverRW.Close()
	})
	return clientRW, serverRW
}

func TestRequestResolvesWithHandlerResult(t *testing.T) {
	clientRW, serverRW := newPair(t)
	NewConn(serverRW, func(method string, params json.RawMessage) (any, error) {
		if method != "add" {
			return nil, &Error{Code: MethodNotFound, Message: method}
		}
		var nums []int
		if err := json.Unmarshal(params, &nums); err != nil {
			return nil, &Error{Code: InvalidParams, Message: err.Error()}
		}
		return nums[0] + nums[1], nil
	})
	client := NewConn(clientRW, nil)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	raw, err := client.Request(ctx, "add", []int{2, 3})
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	var got int
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if got != 5 {
		t.Fatalf("got %d, want 5", got)
	}
}

func TestRequestReturnsHandlerError(t *testing.T) {
	clientRW, serverRW := newPair(t)
	NewConn(serverRW, func(string, json.RawMessage) (any, error) {
		return nil, &Error{Code: InvalidParams, Message: "bad"}
	})
	client := NewConn(clientRW, nil)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	_, err := client.Request(ctx, "anything", nil)
	rpcErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("want *Error, got %T (%v)", err, err)
	}
	if rpcErr.Code != InvalidParams || rpcErr.Message != "bad" {
		t.Fatalf("unexpected error: %+v", rpcErr)
	}
}

func TestBidirectional(t *testing.T) {
	clientRW, serverRW := newPair(t)
	client := NewConn(clientRW, func(method string, _ json.RawMessage) (any, error) {
		if method == "ping" {
			return "pong", nil
		}
		return nil, &Error{Code: MethodNotFound, Message: method}
	})
	NewConn(serverRW, func(method string, _ json.RawMessage) (any, error) {
		if method == "hello" {
			return "world", nil
		}
		return nil, &Error{Code: MethodNotFound, Message: method}
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	raw, err := client.Request(ctx, "hello", nil)
	if err != nil {
		t.Fatalf("client->server request failed: %v", err)
	}
	var s string
	_ = json.Unmarshal(raw, &s)
	if s != "world" {
		t.Fatalf("got %q, want world", s)
	}
}
