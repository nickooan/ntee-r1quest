package app

import (
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// The AI status line shows a key-hint row and advertises the Shift+Tab target.
func TestAIStatusLineHint(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.mode = modeAI

	got := stripANSI(m.renderStatusLine())
	for _, want := range []string{"Ctrl+J newline", "enter send", "↑/↓ scroll", "esc back", "shift+tab → query"} {
		if !strings.Contains(got, want) {
			t.Fatalf("AI status line missing %q; got %q", want, got)
		}
	}
	// The hint must be its own row beneath the input.
	if !strings.Contains(got, "\n") {
		t.Fatalf("AI status line should have an input row and a hint row; got %q", got)
	}
}

// Every primary mode advertises where Shift+Tab goes next (query → history →
// ai → query).
func TestModeSwitchHint(t *testing.T) {
	cases := []struct {
		m    mode
		want string
	}{
		{modeQuery, "shift+tab → history"},
		{modeHistory, "shift+tab → ai"},
		{modeAI, "shift+tab → query"},
	}
	for _, c := range cases {
		m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
		m.mode = c.m
		if got := stripANSI(m.renderStatusLine()); !strings.Contains(got, c.want) {
			t.Fatalf("mode %d status line should contain %q; got %q", c.m, c.want, got)
		}
	}
}
