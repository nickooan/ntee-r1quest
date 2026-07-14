package app

import (
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

// TestRenderAIStyledTranscript exercises the full renderAI pipeline: tool
// messages render as bulleted segment lines, assistant markdown renders via
// segments, and every row stays within the pane width.
func TestRenderAIStyledTranscript(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/r"})
	m.aiMessages = []view.ChatMessage{
		{Role: "user", Content: "find the bug"},
		{Role: "tool", Content: "grep sources", ToolCallID: "t1", ToolStatus: "completed"},
		{Role: "tool", Content: "run tests", ToolCallID: "t2", ToolStatus: "in_progress"},
		{Role: "assistant", Content: "Fixed in `main.go`, see **notes** at https://example.com/a-fairly-long-link-that-wraps"},
	}

	out := m.renderAI(40, 20)
	if !strings.Contains(out, "⏺ grep sources") || !strings.Contains(out, "⏺ run tests") {
		t.Fatalf("tool lines should render with a bullet:\n%s", out)
	}
	plain := stripANSI(out)
	if !strings.Contains(plain, "`main.go`") || !strings.Contains(plain, "**notes**") {
		t.Fatalf("assistant markdown text should survive rendering:\n%s", plain)
	}
	for i, row := range strings.Split(plain, "\n") {
		if n := len([]rune(row)); n > 40 {
			t.Fatalf("row %d exceeds width 40 (%d): %q", i, n, row)
		}
	}
}
