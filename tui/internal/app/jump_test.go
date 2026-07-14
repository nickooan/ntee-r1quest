package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// jumpModel builds an edit-mode model over a TempDir tree: files maps
// root-relative paths to contents; open names the file the editor holds.
func jumpModel(t *testing.T, files map[string]string, open string) Model {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	content := files[open]
	m.openFile = &filetree.OpenViewFile{
		FileName: filepath.Base(open),
		Path:     filepath.Join(root, filepath.FromSlash(open)),
		Content:  content,
	}
	m.mode = modeEdit
	m, _ = m.beginEditSession(content)
	return m
}

// placeCursor puts the editor cursor on the first occurrence of token.
func placeCursor(t *testing.T, m Model, token string) Model {
	t.Helper()
	for i, line := range m.edit.lines {
		if col := strings.Index(line, token); col >= 0 {
			m.edit.cy = i
			m.edit.cx = len([]rune(line[:col])) + 1
			return m
		}
	}
	t.Fatalf("token %q not found in buffer", token)
	return m
}

func ctrlJ(m Model) Model {
	next, _ := apply(m, tea.KeyMsg{Type: tea.KeyCtrlJ})
	return next
}

func ctrlO(m Model) Model {
	next, _ := apply(m, tea.KeyMsg{Type: tea.KeyCtrlO})
	return next
}

func TestJumpToRefPath(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"queries/get.nts":  "ref ../data/example.ntd\nurl \"https://x\"\n",
		"data/example.ntd": "id: 1\n",
	}, "queries/get.nts")
	m = placeCursor(t, m, "../data/example.ntd")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlA})

	m = ctrlJ(m)
	if m.errText != "" {
		t.Fatalf("unexpected error: %q", m.errText)
	}
	if m.mode != modeEdit || filepath.Base(m.openFile.Path) != "example.ntd" {
		t.Fatalf("expected example.ntd in edit mode; got %q mode %d", m.openFile.Path, m.mode)
	}
	if m.edit.cy != 0 || m.edit.cx != 0 {
		t.Fatalf("cursor should sit at the top: cy=%d cx=%d", m.edit.cy, m.edit.cx)
	}
	// The sidebar follows the jump: highlight + ancestor expansion derive from
	// selectedCommand (a .nts-stripped root-relative command value; a .ntd file
	// keeps its extension, matching how the file tree builds command values).
	if m.selectedCommand != "data/example.ntd" {
		t.Fatalf("sidebar should highlight the jumped-to file: %q", m.selectedCommand)
	}
	if m.command != "" || m.keyboardSelectedCommand != "" {
		t.Fatalf("typed query / keyboard highlight should be cleared: %q %q", m.command, m.keyboardSelectedCommand)
	}
}

func TestJumpToDefinitionKey(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\nauth bearer @i(token)\n",
		"data.ntd": "id: 1\nname: \"x\"\ntoken: @env(T or \"t\")\n",
	}, "get.nts")
	// No selection: cursor inside the @i token exercises the word fallback.
	m = placeCursor(t, m, "@i(token)")

	m = ctrlJ(m)
	if m.errText != "" {
		t.Fatalf("unexpected error: %q", m.errText)
	}
	if filepath.Base(m.openFile.Path) != "data.ntd" {
		t.Fatalf("expected data.ntd, got %q", m.openFile.Path)
	}
	if m.edit.cy != 2 || m.edit.cx != 0 {
		t.Fatalf("cursor should land at the start of the token line: cy=%d cx=%d", m.edit.cy, m.edit.cx)
	}
}

func TestJumpDefinitionLastRefWins(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts": "ref a.ntd\nref b.ntd\nheader x, @i(key)\n",
		"a.ntd":   "key: \"first\"\n",
		"b.ntd":   "other: 1\nkey: \"second\"\nkey: \"third\"\n",
	}, "get.nts")
	m = placeCursor(t, m, "@i(key)")

	m = ctrlJ(m)
	// Runtime merge order: the LAST ref defining the key wins, and within a
	// file the LAST duplicate wins.
	if filepath.Base(m.openFile.Path) != "b.ntd" || m.edit.cy != 2 {
		t.Fatalf("expected b.ntd line 2, got %q cy=%d", m.openFile.Path, m.edit.cy)
	}
}

func TestJumpTruncatedSelectionWithDefault(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\nbody @i(age or 20)\n",
		"data.ntd": "age: 2\n",
	}, "get.nts")
	// Ctrl+A on `@i(age or 20)` selects only `@i(age` (word stops at space).
	m = placeCursor(t, m, "@i(age")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlA})
	if got := m.edit.selectedText(); got != "@i(age" {
		t.Fatalf("selection = %q, want %q", got, "@i(age")
	}

	m = ctrlJ(m)
	if filepath.Base(m.openFile.Path) != "data.ntd" || m.edit.cy != 0 {
		t.Fatalf("truncated @i selection should resolve: %q cy=%d err=%q", m.openFile.Path, m.edit.cy, m.errText)
	}
}

func TestJumpToRunTarget(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"chain.joint.nts":    "@joint()\n-> @run(sub/query-user)\n",
		"sub/query-user.nts": "url \"https://x\"\n",
	}, "chain.joint.nts")
	m = placeCursor(t, m, "@run(sub/query-user)")

	m = ctrlJ(m)
	if m.errText != "" {
		t.Fatalf("unexpected error: %q", m.errText)
	}
	if filepath.Base(m.openFile.Path) != "query-user.nts" {
		t.Fatalf("expected query-user.nts, got %q", m.openFile.Path)
	}
}

func TestJumpToFileMacroAndBinary(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"upload.nts":   "body { file: @f(payload.json) }\n",
		"payload.json": "{}\n",
	}, "upload.nts")
	m = placeCursor(t, m, "@f(payload.json)")
	m = ctrlJ(m)
	if filepath.Base(m.openFile.Path) != "payload.json" {
		t.Fatalf("expected payload.json, got %q err=%q", m.openFile.Path, m.errText)
	}

	m = jumpModel(t, map[string]string{
		"upload.nts": "body { file: @f(blob.bin) }\n",
		"blob.bin":   "a\x00b",
	}, "upload.nts")
	m = placeCursor(t, m, "@f(blob.bin)")
	m = ctrlJ(m)
	if !strings.Contains(m.errText, "not a readable file") {
		t.Fatalf("binary target should error, got %q", m.errText)
	}
	if filepath.Base(m.openFile.Path) != "upload.nts" || m.mode != modeEdit {
		t.Fatalf("buffer must be untouched on failure: %q", m.openFile.Path)
	}
}

func TestJumpDirtyBufferBlocks(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\n",
		"data.ntd": "id: 1\n",
	}, "get.nts")
	m = placeCursor(t, m, "data.ntd")
	m = typeRunes(m, "x")

	m = ctrlJ(m)
	if !strings.Contains(m.errText, "save (Ctrl+S) before jumping") {
		t.Fatalf("dirty jump should be blocked, got %q", m.errText)
	}
	if filepath.Base(m.openFile.Path) != "get.nts" {
		t.Fatalf("buffer must not switch: %q", m.openFile.Path)
	}
}

func TestJumpOutsideRoot(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts": "ref ../../outside.ntd\n",
	}, "get.nts")
	m = placeCursor(t, m, "../../outside.ntd")

	m = ctrlJ(m)
	if !strings.Contains(m.errText, "outside the request root") {
		t.Fatalf("outside-root jump should error, got %q", m.errText)
	}
	if len(m.jumpStack) != 0 {
		t.Fatalf("failed jump must not leave a frame: %d", len(m.jumpStack))
	}
}

func TestJumpBackRestoresOrigin(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"queries/get.nts":  "ref ../data/example.ntd\nurl \"https://x\"\n",
		"data/example.ntd": "id: 1\n",
	}, "queries/get.nts")
	m = placeCursor(t, m, "../data/example.ntd")
	originCy, originCx := m.edit.cy, m.edit.cx

	m = ctrlJ(m)
	if filepath.Base(m.openFile.Path) != "example.ntd" {
		t.Fatalf("jump failed: %q err=%q", m.openFile.Path, m.errText)
	}

	m = ctrlO(m)
	if filepath.Base(m.openFile.Path) != "get.nts" {
		t.Fatalf("jump back should restore get.nts, got %q err=%q", m.openFile.Path, m.errText)
	}
	if m.edit.cy != originCy || m.edit.cx != originCx {
		t.Fatalf("cursor should be restored: cy=%d cx=%d want %d/%d", m.edit.cy, m.edit.cx, originCy, originCx)
	}
	// Jump-back moves the sidebar back to the origin too (nested prefix intact
	// so its ancestor directory expands).
	if m.selectedCommand != "queries/get" {
		t.Fatalf("sidebar should return to the origin: %q", m.selectedCommand)
	}

	m = ctrlO(m)
	if !strings.Contains(m.errText, "no jump to return to") {
		t.Fatalf("empty stack should error, got %q", m.errText)
	}
}

func TestJumpStackReleasedOnEsc(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\n",
		"data.ntd": "id: 1\n",
	}, "get.nts")
	m = placeCursor(t, m, "data.ntd")

	m = ctrlJ(m)
	if len(m.jumpStack) != 1 {
		t.Fatalf("expected one frame after jump: %d", len(m.jumpStack))
	}

	// Esc quits edit mode into view of the CURRENT file and ends the trail.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeView || filepath.Base(m.openFile.Path) != "data.ntd" {
		t.Fatalf("esc should view the current file: mode=%d %q", m.mode, m.openFile.Path)
	}
	if len(m.jumpStack) != 0 {
		t.Fatalf("esc must release the jump stack: %d", len(m.jumpStack))
	}

	// Re-entering edit starts fresh; Ctrl+O has nothing to return to.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("e")})
	m = ctrlO(m)
	if !strings.Contains(m.errText, "no jump to return to") {
		t.Fatalf("fresh session should have no trail, got %q", m.errText)
	}
}

func TestJumpNothingUnderCursor(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts": "url \"https://x\"\n\n",
	}, "get.nts")
	m.edit.cy = 1
	m.edit.cx = 0

	m = ctrlJ(m)
	if !strings.Contains(m.errText, "nothing to jump to") {
		t.Fatalf("whitespace cursor should error, got %q", m.errText)
	}

	m.edit.cy = 0
	m.edit.cx = 1 // inside "url" — a token but not a reference
	m = ctrlJ(m)
	if !strings.Contains(m.errText, "no file reference under cursor") {
		t.Fatalf("non-reference token should error, got %q", m.errText)
	}
}

func TestJumpWholeLineRefSelection(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\n",
		"data.ntd": "id: 1\n",
	}, "get.nts")
	m = placeCursor(t, m, "data.ntd")
	// Ctrl+A three times: word → segment → whole line ("ref data.ntd").
	for range 3 {
		m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlA})
	}

	m = ctrlJ(m)
	if filepath.Base(m.openFile.Path) != "data.ntd" {
		t.Fatalf("whole-line ref selection should jump: %q err=%q", m.openFile.Path, m.errText)
	}
}

func TestJumpErrorsForMissingTargets(t *testing.T) {
	m := jumpModel(t, map[string]string{
		"get.nts":  "ref data.ntd\nbody @i(nope)\n-> @run(missing)\n",
		"data.ntd": "id: 1\n",
	}, "get.nts")

	m = placeCursor(t, m, "@i(nope)")
	m = ctrlJ(m)
	if !strings.Contains(m.errText, "@i(nope) is not defined") {
		t.Fatalf("undefined key should error, got %q", m.errText)
	}

	m = placeCursor(t, m, "@run(missing)")
	m = ctrlJ(m)
	if !strings.Contains(m.errText, "cannot open") {
		t.Fatalf("missing run target should error cleanly, got %q", m.errText)
	}
	if strings.Contains(m.edit.content(), "no such file") {
		t.Fatalf("OS error text must not open as a buffer")
	}
}

func TestEditStatusLineShowsError(t *testing.T) {
	m := jumpModel(t, map[string]string{"get.nts": "url \"https://x\"\n"}, "get.nts")
	m.errText = "boom"
	if got := stripANSI(m.renderStatusLine()); !strings.Contains(got, "boom") {
		t.Fatalf("edit status line should show errText: %q", got)
	}
}
