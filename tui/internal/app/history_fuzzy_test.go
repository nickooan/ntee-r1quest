package app

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// historyFuzzyModel is a ready history-mode model with four records whose
// endpoints and URLs are distinct enough to filter apart.
func historyFuzzyModel() Model {
	endpoints := []struct{ endpoint, url string }{
		{"/orders [GET]", "https://api.example.com/orders"},
		{"/orders/{id} [GET]", "https://api.example.com/orders/42"},
		{"/users [POST]", "https://auth.example.com/users"},
		{"/health [GET]", ""},
	}
	records := make([]runtime.ApiCallRecord, len(endpoints))
	for i, e := range endpoints {
		records[i].Endpoint = e.endpoint
		records[i].Request.URL = e.url
	}
	return Model{
		mode:    modeHistory,
		ready:   true,
		width:   100,
		height:  30,
		history: records,
	}
}

func ctrlP() tea.KeyMsg { return tea.KeyMsg{Type: tea.KeyCtrlP} }

func TestHistoryFuzzyOpensWithAllEntries(t *testing.T) {
	m, _ := apply(historyFuzzyModel(), ctrlP())
	if !m.histFuzzyOpen {
		t.Fatal("overlay not open after ctrl+p")
	}
	if m.histFuzzyQuery != "" || m.histFuzzyIndex != 0 {
		t.Fatalf("query=%q index=%d, want empty query at index 0", m.histFuzzyQuery, m.histFuzzyIndex)
	}
	if len(m.histFuzzyMatches) != len(m.history) {
		t.Fatalf("matches = %d, want all %d entries", len(m.histFuzzyMatches), len(m.history))
	}
}

func TestHistoryFuzzyTypingFilters(t *testing.T) {
	m, _ := apply(historyFuzzyModel(), ctrlP())
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	m = typeRunes(m, "auth") // only /users matches, via its URL host
	if len(m.histFuzzyMatches) != 1 {
		t.Fatalf("matches = %d for %q, want 1", len(m.histFuzzyMatches), m.histFuzzyQuery)
	}
	if got := m.histFuzzyMatches[0].Index; got != 2 {
		t.Fatalf("match index = %d, want 2 (/users)", got)
	}
	if m.histFuzzyIndex != 0 {
		t.Fatalf("index = %d after typing, want reset to 0", m.histFuzzyIndex)
	}
}

func TestHistoryFuzzyEnterSelectsRecord(t *testing.T) {
	m := historyFuzzyModel()
	m.historyScrollY, m.historyScrollX = 5, 3
	m, _ = apply(m, ctrlP())
	m = typeRunes(m, "users")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.historyIndex != 2 {
		t.Fatalf("historyIndex = %d, want 2 (/users)", m.historyIndex)
	}
	if m.historyScrollY != 0 || m.historyScrollX != 0 {
		t.Fatalf("scroll = (%d,%d) after enter, want (0,0)", m.historyScrollY, m.historyScrollX)
	}
	if m.histFuzzyOpen || m.histFuzzyCorpus != nil || m.histFuzzyMatches != nil {
		t.Fatal("overlay state not released after enter")
	}
}

func TestHistoryFuzzyEscKeepsSelection(t *testing.T) {
	m := historyFuzzyModel()
	m.historyIndex = 1
	m, _ = apply(m, ctrlP())
	m = typeRunes(m, "users")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.histFuzzyOpen {
		t.Fatal("overlay still open after esc")
	}
	if m.historyIndex != 1 {
		t.Fatalf("historyIndex = %d after esc, want untouched 1", m.historyIndex)
	}
	if m.mode != modeHistory {
		t.Fatal("esc under the overlay left history mode")
	}
	m, _ = apply(m, ctrlP())
	if m.histFuzzyQuery != "" || len(m.histFuzzyMatches) != len(m.history) {
		t.Fatal("reopen did not start fresh")
	}
}

func TestHistoryFuzzyCapturesShiftTab(t *testing.T) {
	m, _ := apply(historyFuzzyModel(), ctrlP())
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftTab})
	if m.mode != modeHistory {
		t.Fatalf("shift+tab under the overlay switched mode to %v", m.mode)
	}
}

func TestHistoryFuzzyInertOutsideHistory(t *testing.T) {
	m := historyFuzzyModel()
	m.mode = modeQuery
	m, _ = apply(m, ctrlP())
	if m.histFuzzyOpen {
		t.Fatal("ctrl+p opened the finder outside history mode")
	}

	empty := historyFuzzyModel()
	empty.history = nil
	empty, _ = apply(empty, ctrlP())
	if empty.histFuzzyOpen {
		t.Fatal("ctrl+p opened the finder on an empty history")
	}
}

func TestHistoryFuzzyEnterWithNoMatches(t *testing.T) {
	m, _ := apply(historyFuzzyModel(), ctrlP())
	m = typeRunes(m, "zzzzzz")
	if len(m.histFuzzyMatches) != 0 {
		t.Fatalf("matches = %d for nonsense query, want 0", len(m.histFuzzyMatches))
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.histFuzzyOpen {
		t.Fatal("overlay still open after enter with no matches")
	}
	if m.historyIndex != 0 {
		t.Fatalf("historyIndex = %d, want untouched 0", m.historyIndex)
	}
}
