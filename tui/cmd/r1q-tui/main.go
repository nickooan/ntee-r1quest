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
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/app"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func main() {
	root := flag.String("r", ".", "request root directory")
	ai := flag.String("ai", "", "ACP adaptor (claude|codex|cursor)")
	script := flag.String("runtime", "dist/src/runtime-server.js", "path to the runtime server script")
	node := flag.String("node", "node", "node binary")
	flag.Parse()

	if err := run(*node, *script, *root, *ai); err != nil {
		fmt.Fprintln(os.Stderr, "r1q-tui:", err)
		os.Exit(1)
	}
}

func run(node, script, root, ai string) error {
	supervisor, err := runtime.Start(runtime.StartOptions{
		NodeBin:      node,
		ServerScript: script,
		Root:         root,
		AI:           ai,
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
		OnSessionStarted: func(runtime.AiSessionStarted) {
			program.Send(app.AiStartedMsg{})
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
	})

	_, err = program.Run()
	return err
}
