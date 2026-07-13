package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/suggest"
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
	e.cx = 9            // inside "old" (value)
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

// A joint buffer swaps the word-path pool: request keywords disappear, the
// joint statements appear; a request buffer keeps its pool plus the @joint
// bootstrap macro.
func TestEditContextJointSwapsPool(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/chain.joint.nts", Content: ""}
	m.mode = modeEdit

	joint := "@joint()\n-> @run(a)\nu"
	m.edit = newEditor(joint)
	m.edit.cy = 2
	m.edit.cx = 1
	items, _ := m.editContext()
	for _, it := range items {
		if it.Label == "url" {
			t.Fatalf("url keyword offered in a joint buffer: %+v", items)
		}
	}

	m.edit = newEditor("@joint()\n@p")
	m.edit.cy = 1
	m.edit.cx = 2
	items, _ = m.editContext()
	if !containsLabel(items, "@pick") {
		t.Fatalf("@pick not offered in joint buffer: %+v", items)
	}

	m.edit = newEditor("@j")
	m.edit.cx = 2
	items, _ = m.editContext()
	if !containsLabel(items, "@joint") {
		t.Fatalf("@joint bootstrap missing from request pool: %+v", items)
	}

	m.edit = newEditor("u")
	m.edit.cx = 1
	items, _ = m.editContext()
	if !containsLabel(items, "url") {
		t.Fatalf("url keyword missing from request pool: %+v", items)
	}
}

// Typing "-" on a joint line offers the step templates; accepting one lands
// the cursor inside the parens. Request buffers never see step items.
func TestEditContextJointStep(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/chain.joint.nts", Content: ""}
	m.mode = modeEdit

	m.edit = newEditor("@joint()\n-")
	m.edit.cy = 1
	m.edit.cx = 1
	items, start := m.editContext()
	if len(items) == 0 || items[0].Kind != "step" {
		t.Fatalf("step items expected: %+v", items)
	}
	if start != 0 {
		t.Fatalf("fragStart = %d, want 0", start)
	}
	m.edit.replaceWord(start, items[0].InsertText, items[0].CursorOffset)
	if m.edit.lines[1] != "-> @run()" || m.edit.cx != 8 {
		t.Fatalf("accept: line %q cx %d", m.edit.lines[1], m.edit.cx)
	}

	// Indentation is preserved: the fragment starts after the indent.
	m.edit = newEditor("@joint()\n  ->")
	m.edit.cy = 1
	m.edit.cx = 4
	_, start = m.editContext()
	if start != 2 {
		t.Fatalf("indented fragStart = %d, want 2", start)
	}

	// A request buffer gets no step items from "-".
	m.edit = newEditor("-")
	m.edit.cx = 1
	items, _ = m.editContext()
	for _, it := range items {
		if it.Kind == "step" {
			t.Fatalf("step items leaked into a request buffer: %+v", items)
		}
	}
}

// The @run( fragment (which crosses '/' — impossible for the word path) routes
// to script completion with fragStart at the fragment start.
func TestEditContextRunFragment(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "query-user.nts"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	jointPath := filepath.Join(dir, "chain.joint.nts")

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: dir})
	m.openFile = &filetree.OpenViewFile{Path: jointPath, Content: ""}
	m.mode = modeEdit

	line := "-> @run(sub/qu"
	m.edit = newEditor("@joint()\n" + line)
	m.edit.cy = 1
	m.edit.cx = len([]rune(line))

	items, start := m.editContext()
	if want := len([]rune("-> @run(")); start != want {
		t.Fatalf("fragStart = %d, want %d", start, want)
	}
	if len(items) != 1 || items[0].Label != "sub/query-user" {
		t.Fatalf("run completion: %+v", items)
	}
	m.edit.replaceWord(start, items[0].InsertText, items[0].CursorOffset)
	if m.edit.lines[1] != "-> @run(sub/query-user" {
		t.Fatalf("accept replaced wrong span: %q", m.edit.lines[1])
	}
}

// type / auth value positions complete methods and schemes in request buffers
// and stay quiet in joint buffers.
func TestEditContextTypeAndAuth(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/a.nts", Content: ""}
	m.mode = modeEdit

	m.edit = newEditor("type p")
	m.edit.cx = 6
	items, start := m.editContext()
	if start != 5 || !containsLabel(items, "post") || !containsLabel(items, "patch") {
		t.Fatalf("type methods: start=%d items=%+v", start, items)
	}

	m.edit = newEditor("auth be")
	m.edit.cx = 7
	items, start = m.editContext()
	if start != 5 || len(items) != 1 || items[0].InsertText != "bearer " {
		t.Fatalf("auth schemes: start=%d items=%+v", start, items)
	}

	m.edit = newEditor("@joint()\ntype p")
	m.edit.cy = 1
	m.edit.cx = 6
	items, _ = m.editContext()
	for _, it := range items {
		if it.Kind == "httpMethod" {
			t.Fatalf("type methods leaked into a joint buffer: %+v", items)
		}
	}
}

// @f( routes to file completion with the fragment crossing path runes.
func TestEditContextFileMacro(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "data.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: dir})
	m.openFile = &filetree.OpenViewFile{Path: filepath.Join(dir, "upload.nts"), Content: ""}
	m.mode = modeEdit

	line := "body { file: @f(da"
	m.edit = newEditor(line)
	m.edit.cx = len([]rune(line))
	items, start := m.editContext()
	if want := len([]rune("body { file: @f(")); start != want {
		t.Fatalf("fragStart = %d, want %d", start, want)
	}
	if len(items) != 1 || items[0].Label != "data.bin" {
		t.Fatalf("file completion: %+v", items)
	}
}

// .ntd buffers get the definition pool: @env yes, request keywords no.
func TestEditContextDefinitionPool(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/data.ntd", Content: ""}
	m.mode = modeEdit

	m.edit = newEditor("@e")
	m.edit.cx = 2
	items, _ := m.editContext()
	if !containsLabel(items, "@env") {
		t.Fatalf("@env missing from .ntd pool: %+v", items)
	}

	m.edit = newEditor("u")
	m.edit.cx = 1
	items, _ = m.editContext()
	if containsLabel(items, "url") {
		t.Fatalf("url keyword leaked into a .ntd buffer: %+v", items)
	}
}

// The overlay renders a right-aligned faint kind tag when the pane is wide
// enough and falls back to label-only when it is not.
func TestRenderEditOverlayKindTag(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/a.nts", Content: ""}
	m.mode = modeEdit
	m.editSuggestions = []suggest.Item{{Label: "@pick", InsertText: "@pick()", Kind: "macro"}}

	wide := stripANSI(strings.Join(m.renderEditOverlay(30), "\n"))
	if !strings.Contains(wide, "@pick") || !strings.Contains(wide, "macro") {
		t.Fatalf("wide overlay should show the kind tag: %q", wide)
	}

	narrow := stripANSI(strings.Join(m.renderEditOverlay(8), "\n"))
	if strings.Contains(narrow, "macro") {
		t.Fatalf("narrow overlay must omit the kind tag: %q", narrow)
	}
}

func containsLabel(items []suggest.Item, label string) bool {
	for _, it := range items {
		if it.Label == label {
			return true
		}
	}
	return false
}
