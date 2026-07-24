package app

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestHistoryCopyKey(t *testing.T) {
	m := historyFuzzyModel()
	m.historyIndex = 2

	next, cmd := m.handleHistoryKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("c")})
	m = next.(Model)
	if cmd == nil {
		t.Fatal("c in history mode should return a copy command")
	}

	m, _ = apply(m, copiedMsg{})
	if m.notice != "copied" {
		t.Fatalf("successful copy should set notice; got %q", m.notice)
	}
	if !strings.Contains(m.View(), "copied") {
		t.Fatalf("history status line should show the copied notice:\n%s", m.View())
	}

	// Any next keystroke clears the transient notice.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.notice != "" {
		t.Fatalf("notice = %q after a keystroke, want cleared", m.notice)
	}
}

func TestHistoryCopyEmptyHistoryIsInert(t *testing.T) {
	m := historyFuzzyModel()
	m.history = nil
	_, cmd := m.handleHistoryKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("c")})
	if cmd != nil {
		t.Fatal("c with empty history should not produce a command")
	}
}
