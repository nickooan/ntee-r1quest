// Package clip copies text to the system clipboard, ported from
// src/runtime/clipboard.ts. Go-local presentation concern (the runtime never
// touches the clipboard).
package clip

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"
)

type clipboardCommand struct {
	name string
	args []string
}

// commandsForPlatform lists clipboard utilities to try in order. macOS has
// pbcopy; Linux has no single standard, so try the common Wayland/X11 tools.
func commandsForPlatform() []clipboardCommand {
	switch runtime.GOOS {
	case "darwin":
		return []clipboardCommand{{name: "pbcopy"}}
	case "linux":
		return []clipboardCommand{
			{name: "wl-copy"},
			{name: "xclip", args: []string{"-selection", "clipboard"}},
			{name: "xsel", args: []string{"--clipboard", "--input"}},
		}
	default:
		return nil
	}
}

// ErrNoClipboard is returned when no clipboard utility is available.
var ErrNoClipboard = errors.New("no clipboard utility available")

// Copy writes text to the first clipboard utility that accepts it.
func Copy(text string) error {
	commands := commandsForPlatform()
	if len(commands) == 0 {
		return ErrNoClipboard
	}

	var lastErr error
	for _, c := range commands {
		cmd := exec.Command(c.name, c.args...)
		cmd.Stdin = strings.NewReader(text)
		if err := cmd.Run(); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = ErrNoClipboard
	}
	return lastErr
}
