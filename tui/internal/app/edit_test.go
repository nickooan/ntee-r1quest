package app

import (
	"regexp"
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripANSI(s string) string { return ansiRe.ReplaceAllString(s, "") }

// Progressive Ctrl+A with the cursor in the value: word → value segment → line.
func TestExpandSelectionValueSide(t *testing.T) {
	e := newEditor("content: asdfasdf basda")
	e.cx = 20 // inside "basda"

	want := []selRange{{18, 23}, {8, 23}, {0, 23}}
	for i, w := range want {
		e.expandSelection()
		if e.sel == nil || *e.sel != w {
			t.Fatalf("press %d: got %v, want %v", i+1, e.sel, w)
		}
	}
	// A further press at the whole-line level is a no-op.
	e.expandSelection()
	if *e.sel != (selRange{0, 23}) {
		t.Fatalf("extra press expanded past line: %v", e.sel)
	}
}

// With the cursor in the key, word == key segment, so it collapses to
// word → whole line (two visible levels), matching the user's example.
func TestExpandSelectionKeySideCollapses(t *testing.T) {
	e := newEditor("content: asdf basda")
	e.cx = 0 // inside "content:"

	want := []selRange{{0, 8}, {0, 19}}
	for i, w := range want {
		e.expandSelection()
		if e.sel == nil || *e.sel != w {
			t.Fatalf("press %d: got %v, want %v", i+1, e.sel, w)
		}
	}
	e.expandSelection()
	if *e.sel != (selRange{0, 19}) {
		t.Fatalf("extra press expanded past line: %v", e.sel)
	}
}

// Selecting the whole line then backspacing clears the line ("remove all").
func TestDeleteWholeLineSelection(t *testing.T) {
	e := newEditor("content: asdfasdf basda")
	e.cx = 5
	e.expandSelection() // word
	e.expandSelection() // key segment (== word here, collapses) → line
	e.expandSelection() // ensure at whole line
	if e.sel == nil || e.sel.start != 0 || e.sel.end != len([]rune(e.lines[0])) {
		t.Fatalf("not whole-line selected: %v", e.sel)
	}
	e.backspace()
	if e.lines[0] != "" {
		t.Fatalf("whole-line backspace did not clear line: %q", e.lines[0])
	}
	if e.cx != 0 || e.sel != nil {
		t.Fatalf("post-delete state cx=%d sel=%v", e.cx, e.sel)
	}
}

// Typing over a selection replaces it.
func TestInsertReplacesSelection(t *testing.T) {
	e := newEditor("token: old")
	e.cx = 9 // inside "old" (value)
	e.expandSelection() // "old"
	if *e.sel != (selRange{7, 10}) {
		t.Fatalf("word select got %v", e.sel)
	}
	e.insert("new")
	if e.lines[0] != "token: new" {
		t.Fatalf("insert-over-selection got %q", e.lines[0])
	}
}

// A cursor move drops the selection.
func TestMoveClearsSelection(t *testing.T) {
	e := newEditor("token: value")
	e.cx = 8
	e.expandSelection()
	if e.sel == nil {
		t.Fatal("expected a selection")
	}
	e.move(-1, 0)
	if e.sel != nil {
		t.Fatalf("move did not clear selection: %v", e.sel)
	}
}

// The edit status line shows a yellow "editing" badge while dirty and a green
// "saved" badge once the buffer matches disk.
func TestEditStatusBadge(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/a.nts", Content: "hi"}
	m.mode = modeEdit
	m.edit = newEditor("hi")

	m.edit.dirty = false
	if got := stripANSI(m.renderStatusLine()); !strings.Contains(got, "saved") ||
		strings.Contains(got, "editing") {
		t.Fatalf("clean buffer: want saved badge, got %q", got)
	}

	m.edit.dirty = true
	if got := stripANSI(m.renderStatusLine()); !strings.Contains(got, "editing") ||
		strings.Contains(got, "saved") {
		t.Fatalf("dirty buffer: want editing badge, got %q", got)
	}
}

// A header line past the comma suggests common values for that header; before
// the comma it still suggests header keys (not values).
func TestEditContextHeaderValues(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/a.nts", Content: ""}
	m.mode = modeEdit

	line := "header content-type, appl"
	m.edit = newEditor(line)
	m.edit.cx = len([]rune(line))

	items, start := m.editContext()
	if start != len([]rune("header content-type, ")) {
		t.Fatalf("fragStart = %d, want %d", start, len([]rune("header content-type, ")))
	}
	found := false
	for _, it := range items {
		if it.Kind == "headerValue" && it.Label == "application/json" {
			found = true
		}
	}
	if !found {
		t.Fatalf("application/json not suggested for content-type value: %+v", items)
	}

	// Before the comma → header-key context, no value suggestions.
	before := "header content-ty"
	m.edit = newEditor(before)
	m.edit.cx = len([]rune(before))
	keyItems, _ := m.editContext()
	for _, it := range keyItems {
		if it.Kind == "headerValue" {
			t.Fatal("header-value suggestions leaked before the comma")
		}
	}
}

// The cursor line scrolls horizontally so the cursor stays visible past width.
func TestRenderEditLineHorizontalScroll(t *testing.T) {
	line := "0123456789ABCDEFGHIJ" // 20 runes

	// Cursor past the right edge: window follows it (off = cx-width+1).
	if got := stripANSI(renderEditLine(line, 15, 10, nil)); got != "6789ABCDEF" {
		t.Errorf("cx=15 width=10: got %q, want %q", got, "6789ABCDEF")
	}
	// Cursor within the first window: shows from column 0.
	if got := stripANSI(renderEditLine(line, 3, 10, nil)); got != "0123456789" {
		t.Errorf("cx=3 width=10: got %q, want %q", got, "0123456789")
	}
	// Short line pads to width; cursor sits just past the last rune.
	if got := stripANSI(renderEditLine("ab", 2, 5, nil)); got != "ab   " {
		t.Errorf("short line: got %q, want %q", got, "ab   ")
	}
}
