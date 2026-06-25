package clip

import (
	"runtime"
	"testing"
)

func TestCommandsForPlatform(t *testing.T) {
	commands := commandsForPlatform()
	switch runtime.GOOS {
	case "darwin":
		if len(commands) != 1 || commands[0].name != "pbcopy" {
			t.Fatalf("darwin should use pbcopy: %+v", commands)
		}
	case "linux":
		if len(commands) == 0 || commands[0].name != "wl-copy" {
			t.Fatalf("linux should try wl-copy first: %+v", commands)
		}
	}
}
