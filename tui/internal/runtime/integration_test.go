//go:build integration

// Cross-language integration test: the Go client against the real TS runtime
// server. Requires a built dist and node. Run with:
//
//	npm run build && go test -tags integration ./internal/runtime/
package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	// internal/runtime -> tui -> repo root
	abs, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return abs
}

func TestGoClientAgainstTSRuntime(t *testing.T) {
	root := repoRoot(t)
	script := filepath.Join(root, "dist", "src", "runtime-server.js")
	if _, err := os.Stat(script); err != nil {
		t.Skipf("runtime server not built (%s); run `npm run build`", script)
	}

	sup, err := Start(StartOptions{
		ServerScript: script,
		Root:         filepath.Join(root, "example"),
		ReadyTimeout: 20 * time.Second,
	})
	if err != nil {
		t.Fatalf("start runtime: %v", err)
	}
	defer sup.Stop()

	client, err := Connect(sup.SocketPath)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cfg, err := client.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig over the wire: %v", err)
	}
	if !strings.HasSuffix(cfg.Root, "example") {
		t.Fatalf("unexpected root: %q", cfg.Root)
	}
	if cfg.Version == "" {
		t.Fatal("expected a version from the TS runtime")
	}
}

// Drives the full request pipeline (parse → HTTP → response) through the Go
// client over the socket. Makes a real network call (jsonplaceholder), so it is
// integration-tagged.
func TestExecuteOverTSRuntime(t *testing.T) {
	root := repoRoot(t)
	script := filepath.Join(root, "dist", "src", "runtime-server.js")
	if _, err := os.Stat(script); err != nil {
		t.Skipf("runtime server not built (%s); run `npm run build`", script)
	}

	sup, err := Start(StartOptions{
		ServerScript: script,
		Root:         filepath.Join(root, "example"),
		ReadyTimeout: 20 * time.Second,
	})
	if err != nil {
		t.Fatalf("start runtime: %v", err)
	}
	defer sup.Stop()

	client, err := Connect(sup.SocketPath)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	res, err := client.Execute(ctx, ExecuteRequest{Command: "request/example"})
	if err != nil {
		t.Fatalf("Execute over the wire: %v", err)
	}
	if res.Status != 200 {
		t.Fatalf("expected 200 from the example request, got %d", res.Status)
	}
	if res.Request.URL == "" {
		t.Fatalf("expected the request URL to round-trip; got %+v", res.Request)
	}
}
