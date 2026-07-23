package app

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

func aiHistoryModel(anchor bool) Model {
	m := Model{aiHistoryAnchor: anchor, aiActive: true}
	for i := 0; i < 40; i++ {
		m.aiMessages = append(m.aiMessages, view.ChatMessage{Role: "user", Content: "old message"})
	}
	m.aiMessages = append(m.aiMessages, view.ChatMessage{Role: "divider"})
	return m
}

// A freshly resumed session shows only the tail of the history (~30% of the
// pane) so the rest stays clear for new turns.
func TestResumedHistoryAnchorsToTopThird(t *testing.T) {
	anchored := aiHistoryModel(true).renderAI(80, 30)
	full := aiHistoryModel(false).renderAI(80, 30)

	anchoredRows := len(strings.Split(anchored, "\n"))
	fullRows := len(strings.Split(full, "\n"))
	if fullRows < 28 {
		t.Fatalf("unanchored transcript should fill the pane: %d rows", fullRows)
	}
	if anchoredRows > 30*3/10+1 {
		t.Fatalf("anchored transcript too tall: %d rows", anchoredRows)
	}
	// The divider (end of history) must be the last visible row.
	rows := strings.Split(anchored, "\n")
	if !strings.Contains(rows[len(rows)-1], "above is history") {
		t.Fatalf("divider should end the anchored view: %q", rows[len(rows)-1])
	}
}

// Scrolling releases the anchor and returns to the full bottom-pinned view.
func TestAnchorClearedByScroll(t *testing.T) {
	m := aiHistoryModel(true)
	m.mode = modeAI
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyUp})
	if m.aiHistoryAnchor {
		t.Fatal("scroll should clear the history anchor")
	}
}
