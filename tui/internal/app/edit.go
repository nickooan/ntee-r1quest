package app

import (
	"strings"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
)

// Minimal multi-line editor state used by edit mode. Full edit-mode parity
// (suggestions overlay, save prompt) is a later D6 increment; this covers
// insert / delete / newline / cursor movement / save.
type editor struct {
	lines []string
	cx    int
	cy    int
	dirty bool
}

func newEditor(content string) editor {
	return editor{lines: strings.Split(content, "\n")}
}

func (e editor) content() string { return strings.Join(e.lines, "\n") }

func (e *editor) line() []rune { return []rune(e.lines[e.cy]) }

func (e *editor) clampCursor() {
	if e.cy < 0 {
		e.cy = 0
	}
	if e.cy > len(e.lines)-1 {
		e.cy = len(e.lines) - 1
	}
	e.cx = input.Clamp(e.cx, 0, len(e.line()))
}

func (e *editor) insert(text string) {
	line := e.line()
	at := input.Clamp(e.cx, 0, len(line))
	e.lines[e.cy] = string(line[:at]) + text + string(line[at:])
	e.cx = at + len([]rune(text))
	e.dirty = true
}

func (e *editor) newline() {
	line := e.line()
	at := input.Clamp(e.cx, 0, len(line))
	before := string(line[:at])
	after := string(line[at:])
	e.lines[e.cy] = before
	rest := append([]string{after}, e.lines[e.cy+1:]...)
	e.lines = append(e.lines[:e.cy+1], rest...)
	e.cy++
	e.cx = 0
	e.dirty = true
}

func (e *editor) backspace() {
	if e.cx > 0 {
		line := e.line()
		e.lines[e.cy] = string(line[:e.cx-1]) + string(line[e.cx:])
		e.cx--
		e.dirty = true
		return
	}
	if e.cy == 0 {
		return
	}
	// Merge with the previous line.
	prev := []rune(e.lines[e.cy-1])
	e.cx = len(prev)
	e.lines[e.cy-1] = string(prev) + e.lines[e.cy]
	e.lines = append(e.lines[:e.cy], e.lines[e.cy+1:]...)
	e.cy--
	e.dirty = true
}

func (e *editor) move(dx, dy int) {
	e.cy = input.Clamp(e.cy+dy, 0, len(e.lines)-1)
	e.cx = input.Clamp(e.cx+dx, 0, len(e.line()))
}
