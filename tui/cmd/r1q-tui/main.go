// Command r1q-tui is the Go/Bubble Tea front-end. It spawns the TS runtime
// server, connects over a Unix-domain socket, and renders the TUI. (Vertical
// slice — query mode; see internal/app.)
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/app"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func main() {
	root := flag.String("r", ".", "request root directory")
	ai := flag.String("ai", "", "ACP adaptor (claude|codex|cursor)")
	env := flag.String("env", "", "JSON env overrides for @env macros")
	script := flag.String("runtime", "dist/src/runtime-server.js", "path to the runtime server script")
	node := flag.String("node", "node", "node binary")
	flag.Parse()

	if err := run(*node, *script, *root, *ai, *env); err != nil {
		fmt.Fprintln(os.Stderr, "r1q-tui:", err)
		os.Exit(1)
	}
}

func run(node, script, root, ai, env string) error {
	// Resolve the root to an absolute path so request resolution is independent
	// of the runtime process's working directory.
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}

	supervisor, err := runtime.Start(runtime.StartOptions{
		NodeBin:      node,
		ServerScript: script,
		Root:         root,
		AI:           ai,
		Env:          env,
	})
	if err != nil {
		return err
	}
	defer supervisor.Stop()

	client, err := runtime.Connect(supervisor.SocketPath)
	if err != nil {
		return fmt.Errorf("connecting to runtime: %w", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	config, err := client.GetConfig(ctx)
	cancel()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	program := tea.NewProgram(app.New(client, config), tea.WithAltScreen())

	client.Subscribe(runtime.EventHandlers{
		OnExternalEvent: func(event runtime.ExternalRequestEvent) {
			program.Send(app.ExternalEventMsg{Event: event})
		},
		OnSessionUpdate: func(update runtime.AiSessionUpdate) {
			program.Send(app.AiUpdateMsg{Update: update.Update})
		},
		OnSessionStarted: func(started runtime.AiSessionStarted) {
			program.Send(app.AiStartedMsg{
				Resumed:          started.Resumed,
				SupportsSteering: started.SupportsSteering,
			})
		},
		OnSessionStopped: func(stopped runtime.AiSessionStopped) {
			var err error
			if stopped.Error != nil {
				err = stopped.Error
			}
			program.Send(app.AiStoppedMsg{Err: err})
		},
		OnSessionError: func(err error) {
			program.Send(app.AiErrorMsg{Err: err})
		},
		OnPermissionRequest: func(raw json.RawMessage) {
			program.Send(app.AiPermissionMsg{Raw: raw})
		},
		// Generic runtime errors during an AI session (mirrors onError →
		// setLocalError in the Ink controller).
		OnError: func(err error) {
			program.Send(app.AiErrorMsg{Err: err})
		},
	})

	_, err = program.Run()
	return err
}
