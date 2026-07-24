package app

import (
	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/fuzzy"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// History fuzzy finder (Ctrl+P), mirroring ntee-editor's Ctrl+P: an overlay
// over the history list that fuzzy-matches the endpoint label and the full
// request URL. Enter selects the entry — the sidebar highlights it and the
// right pane shows the request/response — Esc cancels without moving the
// selection.

// historyFuzzyText is the one string a record is both matched and displayed
// by: the endpoint label, plus the full request URL when the record has one so
// host and query fragments are searchable too.
func historyFuzzyText(r runtime.ApiCallRecord) string {
	if r.Request.URL == "" {
		return r.Endpoint
	}
	return r.Endpoint + "  " + r.Request.URL
}

// openHistoryFuzzy prepares the corpus in history order, so a Match.Index is
// directly an index into m.history.
func (m Model) openHistoryFuzzy() Model {
	if len(m.history) == 0 {
		return m
	}
	texts := make([]string, len(m.history))
	for i, r := range m.history {
		texts[i] = historyFuzzyText(r)
	}
	m.histFuzzyOpen = true
	m.histFuzzyQuery = ""
	m.histFuzzyIndex = 0
	m.histFuzzyCorpus = fuzzy.Prepare(texts)
	m.histFuzzyMatches = fuzzy.Filter("", m.histFuzzyCorpus)
	return m
}

// closeHistoryFuzzy drops the corpus and matches so nothing stays resident
// between opens.
func (m Model) closeHistoryFuzzy() Model {
	m.histFuzzyOpen = false
	m.histFuzzyQuery = ""
	m.histFuzzyIndex = 0
	m.histFuzzyCorpus = nil
	m.histFuzzyMatches = nil
	return m
}

func (m Model) refreshHistoryFuzzy() Model {
	m.histFuzzyMatches = fuzzy.Filter(m.histFuzzyQuery, m.histFuzzyCorpus)
	m.histFuzzyIndex = 0
	return m
}

func (m Model) handleHistoryFuzzyKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC:
		return m, tea.Quit
	case tea.KeyEsc, tea.KeyCtrlP:
		m = m.closeHistoryFuzzy()
	case tea.KeyEnter:
		if len(m.histFuzzyMatches) == 0 {
			m = m.closeHistoryFuzzy()
			break
		}
		idx := input.Clamp(m.histFuzzyIndex, 0, len(m.histFuzzyMatches)-1)
		m.historyIndex = m.histFuzzyMatches[idx].Index
		// Reset the right-pane scroll so the record opens at the top, same as
		// the Shift+↑/↓ selection keys.
		m.historyScrollY, m.historyScrollX = 0, 0
		m = m.closeHistoryFuzzy()
	case tea.KeyUp:
		m.histFuzzyIndex = max(0, m.histFuzzyIndex-1)
	case tea.KeyDown:
		m.histFuzzyIndex = min(max(0, len(m.histFuzzyMatches)-1), m.histFuzzyIndex+1)
	case tea.KeyBackspace:
		if runes := []rune(m.histFuzzyQuery); len(runes) > 0 {
			m.histFuzzyQuery = string(runes[:len(runes)-1])
			m = m.refreshHistoryFuzzy()
		}
	case tea.KeySpace:
		m.histFuzzyQuery += " "
		m = m.refreshHistoryFuzzy()
	case tea.KeyRunes:
		m.histFuzzyQuery += string(msg.Runes)
		m = m.refreshHistoryFuzzy()
	}
	return m, nil
}
