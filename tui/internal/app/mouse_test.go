package app

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
)

// editMouseModel is a 100x30 edit-mode model: sidebarWidth=25, so the pane
// text area starts at screen (x=31, y=2) with a 2-digit gutter, and shows 24
// buffer rows.
func editMouseModel() Model {
	var b strings.Builder
	for i := 0; i < 10; i++ {
		fmt.Fprintf(&b, "line number %d\n", i)
	}
	content := strings.TrimSuffix(b.String(), "\n")
	return Model{
		mode:     modeEdit,
		ready:    true,
		width:    100,
		height:   30,
		openFile: &filetree.OpenViewFile{FileName: "a.nts", Path: "/tmp/a.nts", Content: content},
		edit:     newEditor(content),
	}
}

func click(x, y int, ctrl bool) tea.MouseMsg {
	return tea.MouseMsg{X: x, Y: y, Ctrl: ctrl, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft}
}

func TestMouseClickMovesCursor(t *testing.T) {
	m, _ := apply(editMouseModel(), click(36, 5, false))
	if m.edit.cy != 3 || m.edit.cx != 5 {
		t.Fatalf("cursor = (%d,%d), want (3,5)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseClickGutterClampsToColumnZero(t *testing.T) {
	m, _ := apply(editMouseModel(), click(27, 2, false))
	if m.edit.cy != 0 || m.edit.cx != 0 {
		t.Fatalf("cursor = (%d,%d), want (0,0)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseClickClampsToLineLength(t *testing.T) {
	// Far right of "line number 3" (13 runes) clamps to end of line.
	m, _ := apply(editMouseModel(), click(95, 5, false))
	if m.edit.cy != 3 || m.edit.cx != 13 {
		t.Fatalf("cursor = (%d,%d), want (3,13)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseIgnoresSidebarDragAndBelowEOF(t *testing.T) {
	start := editMouseModel()
	start.edit.cy, start.edit.cx = 2, 4

	for name, msg := range map[string]tea.MouseMsg{
		"sidebar click": click(10, 5, false),
		"header click":  click(36, 0, false),
		"below EOF":     click(36, 15, false), // pane background past line 9
		"drag motion":   {X: 36, Y: 5, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft},
		"release":       {X: 36, Y: 5, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft},
		"right click":   {X: 36, Y: 5, Action: tea.MouseActionPress, Button: tea.MouseButtonRight},
	} {
		m, _ := apply(start, msg)
		if m.edit.cy != 2 || m.edit.cx != 4 {
			t.Fatalf("%s moved cursor to (%d,%d)", name, m.edit.cy, m.edit.cx)
		}
	}
}

func TestMouseWheelMovesEditCursor(t *testing.T) {
	m, _ := apply(editMouseModel(), tea.MouseMsg{Action: tea.MouseActionPress, Button: tea.MouseButtonWheelDown})
	if m.edit.cy != wheelScrollLines {
		t.Fatalf("cy = %d after wheel down, want %d", m.edit.cy, wheelScrollLines)
	}
	m, _ = apply(m, tea.MouseMsg{Action: tea.MouseActionPress, Button: tea.MouseButtonWheelUp})
	m, _ = apply(m, tea.MouseMsg{Action: tea.MouseActionPress, Button: tea.MouseButtonWheelUp})
	if m.edit.cy != 0 {
		t.Fatalf("cy = %d after wheel up past the top, want 0", m.edit.cy)
	}
}

func TestCtrlClickRunsJump(t *testing.T) {
	// The clicked word is not a file reference, so the jump path reports it —
	// proving Ctrl+click placed the cursor and invoked jumpToReference.
	m, _ := apply(editMouseModel(), click(36, 5, true))
	if m.edit.cy != 3 || m.edit.cx != 5 {
		t.Fatalf("cursor = (%d,%d), want (3,5)", m.edit.cy, m.edit.cx)
	}
	if m.errText != "no file reference under cursor" {
		t.Fatalf("errText = %q, want jump's no-reference error", m.errText)
	}
}
