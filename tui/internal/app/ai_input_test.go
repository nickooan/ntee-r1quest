package app

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// aiInputModel is an 80x24 AI-mode model: wrap width 73, so a single-row input
// puts the input row at screen y=21 with text starting at x=6.
func aiInputModel(text string, cursor int) Model {
	return Model{
		mode:          modeAI,
		ready:         true,
		width:         80,
		height:        24,
		aiInput:       text,
		aiInputCursor: cursor,
	}
}

func TestAiPlainUpDownMoveCursorNotScroll(t *testing.T) {
	m, _ := apply(aiInputModel("hello\nworld", 8), tea.KeyMsg{Type: tea.KeyUp})
	if m.aiInputCursor != 2 {
		t.Fatalf("cursor = %d after up, want 2", m.aiInputCursor)
	}
	if m.aiScrollY != 0 {
		t.Fatalf("plain up scrolled the transcript: %d", m.aiScrollY)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.aiInputCursor != 8 {
		t.Fatalf("cursor = %d after down, want 8", m.aiInputCursor)
	}
	// Boundary rule: up on the top row goes to the start of the input.
	m, _ = apply(aiInputModel("hello", 3), tea.KeyMsg{Type: tea.KeyUp})
	if m.aiInputCursor != 0 {
		t.Fatalf("top-row up cursor = %d, want 0", m.aiInputCursor)
	}
}

func TestAiShiftUpDownScrollTranscript(t *testing.T) {
	m, _ := apply(aiInputModel("hello", 3), tea.KeyMsg{Type: tea.KeyShiftUp})
	if m.aiScrollY != 1 || m.aiInputCursor != 3 {
		t.Fatalf("shift+up: scrollY=%d cursor=%d, want 1 and 3", m.aiScrollY, m.aiInputCursor)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.aiScrollY != 0 {
		t.Fatalf("shift+down: scrollY=%d, want 0", m.aiScrollY)
	}
}

func TestAiForwardDelete(t *testing.T) {
	m, _ := apply(aiInputModel("abc", 1), tea.KeyMsg{Type: tea.KeyDelete})
	if m.aiInput != "ac" || m.aiInputCursor != 1 {
		t.Fatalf("delete: input=%q cursor=%d, want \"ac\" and 1", m.aiInput, m.aiInputCursor)
	}
}

func TestAiInputSoftWraps(t *testing.T) {
	long := strings.Repeat("x", 100) // wraps at 73 into two rows
	m := aiInputModel(long, 0)
	status := m.renderStatusLine()
	if got := strings.Count(status, "\n"); got != 2 { // 2 input rows + hint
		t.Fatalf("status newlines = %d, want 2", got)
	}
	for _, row := range strings.Split(status, "\n") {
		if n := lipgloss.Width(row); n > m.width {
			t.Fatalf("status row overflows: %d > %d", n, m.width)
		}
	}
}

func TestAiCtrlAProgressiveSelect(t *testing.T) {
	// First Ctrl+A selects the cursor's line; backspace removes just that line.
	m, _ := apply(aiInputModel("abc\ndef", 5), tea.KeyMsg{Type: tea.KeyCtrlA})
	if m.aiSel == nil || m.aiSel.start != 4 || m.aiSel.end != 7 {
		t.Fatalf("first ctrl+a sel = %+v, want {4 7}", m.aiSel)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyBackspace})
	if m.aiInput != "abc\n" || m.aiInputCursor != 4 || m.aiSel != nil {
		t.Fatalf("line delete: input=%q cursor=%d sel=%+v", m.aiInput, m.aiInputCursor, m.aiSel)
	}

	// Second Ctrl+A expands to the whole input; backspace clears everything.
	m, _ = apply(aiInputModel("abc\ndef", 5), tea.KeyMsg{Type: tea.KeyCtrlA})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlA})
	if m.aiSel == nil || m.aiSel.start != 0 || m.aiSel.end != 7 {
		t.Fatalf("second ctrl+a sel = %+v, want {0 7}", m.aiSel)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyBackspace})
	if m.aiInput != "" || m.aiInputCursor != 0 {
		t.Fatalf("delete-all: input=%q cursor=%d", m.aiInput, m.aiInputCursor)
	}

	// An empty cursor line skips straight to select-all.
	m, _ = apply(aiInputModel("abc\n\ndef", 4), tea.KeyMsg{Type: tea.KeyCtrlA})
	if m.aiSel == nil || m.aiSel.start != 0 || m.aiSel.end != 8 {
		t.Fatalf("empty-line ctrl+a sel = %+v, want {0 8}", m.aiSel)
	}
}

func TestAiCtrlASelectionDeleteAndReplace(t *testing.T) {
	// Typing replaces the selected line only.
	m, _ := apply(aiInputModel("abc\ndef", 5), tea.KeyMsg{Type: tea.KeyCtrlA})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("Z")})
	if m.aiInput != "abc\nZ" || m.aiSel != nil {
		t.Fatalf("replace: input=%q sel=%+v", m.aiInput, m.aiSel)
	}

	// Esc keeps the text and only deselects; the next backspace is single-rune.
	m, _ = apply(aiInputModel("abc", 3), tea.KeyMsg{Type: tea.KeyCtrlA})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.aiInput != "abc" || m.aiSel != nil || m.mode != modeAI {
		t.Fatalf("esc: input=%q sel=%+v mode=%v", m.aiInput, m.aiSel, m.mode)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyBackspace})
	if m.aiInput != "ab" {
		t.Fatalf("post-deselect backspace: input=%q", m.aiInput)
	}

	// Ctrl+A on an empty input selects nothing.
	m, _ = apply(aiInputModel("", 0), tea.KeyMsg{Type: tea.KeyCtrlA})
	if m.aiSel != nil {
		t.Fatal("empty input should not select")
	}
}

