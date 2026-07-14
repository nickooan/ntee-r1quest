package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/suggest"
)

// Jump-to-reference (Ctrl+J) and jump-back (Ctrl+O) for edit mode: the token
// under the Ctrl+A selection (or the cursor) names a file — a ref'd .ntd, an
// @run step target, an @f upload — or an @i key whose defining .ntd line is
// the destination.

// Classification regexes are non-anchored so whole-line selections
// (`ref ../a.ntd`, `-> @run(x)`) classify without prefix stripping, and the
// closing paren is optional — Ctrl+A on `@i(key or "x")` selects only
// `@i(key` (the word stops at the space).
var (
	jumpIPattern   = regexp.MustCompile(`@i\(\s*([A-Za-z][A-Za-z0-9_-]*)`)
	jumpRunPattern = regexp.MustCompile(`@run\(([A-Za-z0-9/._-]+)`)
	jumpFPattern   = regexp.MustCompile(`@f\(([^\s)]+)`)
	jumpNtdPattern = regexp.MustCompile(`([^\s)]+\.ntd)\b`)
)

type jumpKind int

const (
	jumpNtd jumpKind = iota
	jumpKey
	jumpRun
	jumpFile
)

type jumpTarget struct {
	kind jumpKind
	// path as written, relative to the open file's directory (empty for
	// jumpKey, whose destination comes from the ref'd .ntd scan).
	path string
	key  string
}

// jumpFrame records where a jump left from, so Ctrl+O can return there.
type jumpFrame struct {
	relPath string // root-relative path of the file
	cy, cx  int
	scrollY int
}

const maxJumpFrames = 20

// classifyJumpToken matches the more specific macro forms before the bare
// .ntd path, so a whole-line ref selection still lands on the path rule.
func classifyJumpToken(token string) (jumpTarget, bool) {
	if m := jumpIPattern.FindStringSubmatch(token); m != nil {
		return jumpTarget{kind: jumpKey, key: m[1]}, true
	}
	if m := jumpRunPattern.FindStringSubmatch(token); m != nil {
		return jumpTarget{kind: jumpRun, path: m[1]}, true
	}
	if m := jumpFPattern.FindStringSubmatch(token); m != nil {
		return jumpTarget{kind: jumpFile, path: m[1]}, true
	}
	if m := jumpNtdPattern.FindStringSubmatch(token); m != nil {
		return jumpTarget{kind: jumpNtd, path: m[1]}, true
	}
	return jumpTarget{}, false
}

// jumpToken returns the text the jump should classify: the active selection,
// or the whitespace-delimited token under the cursor (the same token a first
// Ctrl+A would select).
func (m Model) jumpToken() string {
	if selected := m.edit.selectedText(); selected != "" {
		return selected
	}
	line := []rune(m.edit.lines[m.edit.cy])
	word := wordRange(line, m.edit.cx)
	return string(line[input.Clamp(word.start, 0, len(line)):input.Clamp(word.end, 0, len(line))])
}

func (m Model) jumpToReference() (tea.Model, tea.Cmd) {
	if m.openFile == nil {
		return m, nil
	}
	if m.edit.dirty {
		// Jumping resets the editor and its undo timeline — unsaved work
		// would silently vanish.
		m.errText = "unsaved changes — save (Ctrl+S) before jumping"
		return m, nil
	}

	token := m.jumpToken()
	if strings.TrimSpace(token) == "" {
		m.errText = "nothing to jump to"
		return m, nil
	}
	target, ok := classifyJumpToken(token)
	if !ok {
		m.errText = "no file reference under cursor"
		return m, nil
	}

	var abs string
	var line int
	switch target.kind {
	case jumpKey:
		ntdPath, keyLine, found := suggest.ResolveKeyDefinition(
			m.openFile.Path, m.edit.content(), target.key)
		if !found {
			m.errText = "@i(" + target.key + ") is not defined in any ref'd .ntd"
			return m, nil
		}
		abs, line = ntdPath, keyLine
	default:
		path := target.path
		if target.kind == jumpRun && filepath.Ext(path) == "" {
			path += ".nts"
		}
		abs = filepath.Clean(filepath.Join(filepath.Dir(m.openFile.Path), path))
	}

	rel, err := filepath.Rel(m.config.Root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		m.errText = "cannot open " + filepath.Base(abs) + " (outside the request root)"
		return m, nil
	}

	// Record where we left from before switching buffers.
	origin, err := filepath.Rel(m.config.Root, m.openFile.Path)
	if err == nil {
		m.jumpStack = append(m.jumpStack, jumpFrame{
			relPath: filepath.ToSlash(origin),
			cy:      m.edit.cy,
			cx:      m.edit.cx,
			scrollY: m.fileScrollY,
		})
		if len(m.jumpStack) > maxJumpFrames {
			m.jumpStack = m.jumpStack[len(m.jumpStack)-maxJumpFrames:]
		}
	}

	next, cmd, opened := m.openJumpFile(filepath.ToSlash(rel), line, 0, 0)
	if !opened && len(next.jumpStack) > 0 {
		next.jumpStack = next.jumpStack[:len(next.jumpStack)-1]
	}
	return next, cmd
}

func (m Model) jumpBack() (tea.Model, tea.Cmd) {
	if m.openFile == nil {
		return m, nil
	}
	if m.edit.dirty {
		m.errText = "unsaved changes — save (Ctrl+S) before jumping"
		return m, nil
	}
	if len(m.jumpStack) == 0 {
		m.errText = "no jump to return to"
		return m, nil
	}

	frame := m.jumpStack[len(m.jumpStack)-1]
	m.jumpStack = m.jumpStack[:len(m.jumpStack)-1]
	// A frame whose file vanished stays popped — retrying forever is worse.
	next, cmd, _ := m.openJumpFile(frame.relPath, frame.cy, frame.cx, frame.scrollY)
	return next, cmd
}

// openJumpFile opens a root-relative path in edit mode with the cursor placed
// at (cy, cx). Reports whether the file was opened; on failure the model
// carries the error and the current buffer is untouched.
func (m Model) openJumpFile(relToRoot string, cy, cx, scrollY int) (Model, tea.Cmd, bool) {
	// ReadViewFile embeds read errors as buffer content — stat first so a
	// missing target errors instead of opening a buffer of the OS error text.
	abs := filepath.Join(m.config.Root, filepath.FromSlash(relToRoot))
	if info, err := os.Stat(abs); err != nil || info.IsDir() {
		m.errText = "cannot open " + relToRoot
		return m, nil, false
	}

	file, ok := filetree.ReadViewFile(m.config.Root, relToRoot)
	if !ok {
		m.errText = "cannot open " + relToRoot
		return m, nil, false
	}
	if file.Binary {
		m.errText = file.FileName + " is not a readable file"
		return m, nil, false
	}

	m.openFile = &file
	m.mode = modeEdit
	// Move the sidebar highlight (and ancestor expansion + scroll) to the
	// file we jumped to, so the tree reflects the current buffer.
	m = m.selectSidebarCommand(strings.TrimSuffix(relToRoot, ".nts"))
	var cmd tea.Cmd
	m, cmd = m.beginEditSession(file.Content)
	// beginEditSession zeroes the cursor; place it afterwards. renderFile
	// keeps the cursor line in view in edit mode, so no scroll math needed.
	m.edit.cy = cy
	m.edit.cx = cx
	m.edit.clampCursor()
	m.fileScrollY = scrollY
	return m, cmd, true
}
