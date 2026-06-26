package jsonrpc

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strconv"
	"sync"
	"sync/atomic"
)

// Handler handles one inbound request or notification. Return a value to answer
// a request; return an error (an *Error to set a specific code/data, or any
// error for InternalError) to fail it. The return value is ignored for
// notifications. The same handler serves both directions, so a peer can act as
// client and server at once (bidirectional — plan §4).
type Handler func(method string, params json.RawMessage) (any, error)

// Conn is a full-duplex JSON-RPC 2.0 endpoint over any io.ReadWriteCloser (a UDS
// socket, a child process stdio pair, or an in-memory pipe in tests).
type Conn struct {
	rw      io.ReadWriteCloser
	reader  *bufio.Reader
	handler Handler

	writeMu sync.Mutex

	mu      sync.Mutex
	nextID  int64
	pending map[int64]chan *Message
	closed  bool
	closeFn sync.Once

	// Notifications are dispatched by a single worker so they run in arrival
	// order — streaming events (e.g. AI message chunks) must not be reordered.
	notifications chan *Message
	done          chan struct{}
}

// NewConn starts a connection and its read loop. handler may be nil if this peer
// only makes outbound calls.
func NewConn(rw io.ReadWriteCloser, handler Handler) *Conn {
	c := &Conn{
		rw:            rw,
		reader:        bufio.NewReader(rw),
		handler:       handler,
		pending:       make(map[int64]chan *Message),
		notifications: make(chan *Message, 256),
		done:          make(chan struct{}),
	}
	go c.readLoop()
	go c.notificationLoop()
	return c
}

// Request sends a request and blocks until the response arrives or ctx is done.
func (c *Conn) Request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	raw, err := marshalParams(params)
	if err != nil {
		return nil, err
	}

	id := atomic.AddInt64(&c.nextID, 1)
	ch := make(chan *Message, 1)

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, &Error{Code: InternalError, Message: "connection is closed"}
	}
	c.pending[id] = ch
	c.mu.Unlock()

	idRaw := json.RawMessage(strconv.FormatInt(id, 10))
	if err := c.write(&Message{JSONRPC: "2.0", ID: &idRaw, Method: method, Params: raw}); err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, err
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	case resp := <-ch:
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	}
}

// Notify sends a fire-and-forget notification (no response expected).
func (c *Conn) Notify(method string, params any) error {
	raw, err := marshalParams(params)
	if err != nil {
		return err
	}
	return c.write(&Message{JSONRPC: "2.0", Method: method, Params: raw})
}

// Close shuts the connection and fails every in-flight request.
func (c *Conn) Close() error {
	c.shutdown(&Error{Code: InternalError, Message: "connection closed by caller"})
	return c.rw.Close()
}

func (c *Conn) write(msg *Message) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return writeMessage(c.rw, msg)
}

func (c *Conn) readLoop() {
	for {
		msg, err := readMessage(c.reader)
		if err != nil {
			c.shutdown(&Error{Code: InternalError, Message: err.Error()})
			return
		}
		c.dispatch(msg)
	}
}

func (c *Conn) dispatch(msg *Message) {
	if msg.isResponse() {
		c.resolveResponse(msg)
		return
	}
	if msg.ID != nil {
		go c.handleRequest(msg)
	} else {
		// Queue for the ordered worker; drop if the connection is closing.
		select {
		case c.notifications <- msg:
		case <-c.done:
		}
	}
}

// notificationLoop processes notifications one at a time, in arrival order.
func (c *Conn) notificationLoop() {
	for {
		select {
		case msg := <-c.notifications:
			c.handleNotification(msg)
		case <-c.done:
			return
		}
	}
}

func (c *Conn) resolveResponse(msg *Message) {
	id, err := strconv.ParseInt(string(*msg.ID), 10, 64)
	if err != nil {
		return
	}
	c.mu.Lock()
	ch := c.pending[id]
	delete(c.pending, id)
	c.mu.Unlock()
	if ch != nil {
		ch <- msg
	}
}

func (c *Conn) handleRequest(msg *Message) {
	resp := &Message{JSONRPC: "2.0", ID: msg.ID}
	result, err := c.invoke(msg)
	if err != nil {
		resp.Error = toError(err)
	} else {
		raw, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			resp.Error = &Error{Code: InternalError, Message: marshalErr.Error()}
		} else {
			resp.Result = raw
		}
	}
	_ = c.write(resp)
}

func (c *Conn) handleNotification(msg *Message) {
	// Notifications have no response channel; ignore handler errors.
	_, _ = c.invoke(msg)
}

func (c *Conn) invoke(msg *Message) (any, error) {
	if c.handler == nil {
		return nil, &Error{Code: MethodNotFound, Message: "no handler for " + msg.Method}
	}
	return c.handler(msg.Method, msg.Params)
}

func (c *Conn) shutdown(reason *Error) {
	c.closeFn.Do(func() {
		close(c.done)
		c.mu.Lock()
		c.closed = true
		pending := c.pending
		c.pending = make(map[int64]chan *Message)
		c.mu.Unlock()
		for _, ch := range pending {
			ch <- &Message{JSONRPC: "2.0", Error: reason}
		}
	})
}

func marshalParams(params any) (json.RawMessage, error) {
	if params == nil {
		return nil, nil
	}
	return json.Marshal(params)
}

// toError maps a handler error to a JSON-RPC error object. An *Error passes
// through unchanged; anything else becomes InternalError.
func toError(err error) *Error {
	if rpcErr, ok := err.(*Error); ok {
		return rpcErr
	}
	return &Error{Code: InternalError, Message: err.Error()}
}
