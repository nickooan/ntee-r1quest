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

func click(x, y int) tea.MouseMsg {
	return tea.MouseMsg{X: x, Y: y, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft}
}

func TestMouseClickMovesCursor(t *testing.T) {
	m, _ := apply(editMouseModel(), click(36, 5))
	if m.edit.cy != 3 || m.edit.cx != 5 {
		t.Fatalf("cursor = (%d,%d), want (3,5)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseClickGutterClampsToColumnZero(t *testing.T) {
	m, _ := apply(editMouseModel(), click(27, 2))
	if m.edit.cy != 0 || m.edit.cx != 0 {
		t.Fatalf("cursor = (%d,%d), want (0,0)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseClickClampsToLineLength(t *testing.T) {
	// Far right of "line number 3" (13 runes) clamps to end of line.
	m, _ := apply(editMouseModel(), click(95, 5))
	if m.edit.cy != 3 || m.edit.cx != 13 {
		t.Fatalf("cursor = (%d,%d), want (3,13)", m.edit.cy, m.edit.cx)
	}
}

func TestMouseIgnoresSidebarDragAndBelowEOF(t *testing.T) {
	start := editMouseModel()
	start.edit.cy, start.edit.cx = 2, 4

	for name, msg := range map[string]tea.MouseMsg{
		"sidebar click": click(10, 5),
		"header click":  click(36, 0),
		"below EOF":     click(36, 15), // pane background past line 9
		"drag motion":   {X: 36, Y: 5, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft},
		"release":       {X: 36, Y: 5, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft},
		"right click":   {X: 36, Y: 5, Action: tea.MouseActionPress, Button: tea.MouseButtonRight},
		"wheel down":    {Action: tea.MouseActionPress, Button: tea.MouseButtonWheelDown},
	} {
		m, _ := apply(start, msg)
		if m.edit.cy != 2 || m.edit.cx != 4 {
			t.Fatalf("%s moved cursor to (%d,%d)", name, m.edit.cy, m.edit.cx)
		}
	}
}

func TestMouseCaptureTogglesWithEditMode(t *testing.T) {
	// Entering and leaving edit mode must emit a command (the mouse
	// enable/disable is batched onto the transition); the msg types are
	// unexported in bubbletea, so assert the cmd is non-nil.
	m := editMouseModel()
	m.mode = modeView

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("e")})
	if m.mode != modeEdit {
		t.Fatalf("mode = %v after 'e', want modeEdit", m.mode)
	}
	if cmd == nil {
		t.Fatal("entering edit mode returned nil cmd, want mouse-enable batch")
	}

	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode == modeEdit {
		t.Fatal("still in modeEdit after esc")
	}
	if cmd == nil {
		t.Fatal("leaving edit mode returned nil cmd, want mouse-disable batch")
	}
}
