package app

import (
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
)

// Mouse support, mirroring ntee-editor: a left click places the edit cursor on
// the clicked cell, Ctrl+left click also follows the reference under it (the
// Ctrl+J jump), and the wheel moves the edit cursor or scrolls the file view.
// Everything else — drags, releases, bare right clicks, other buttons — is
// deliberately inert, so a stray trackpad gesture never edits anything.

// wheelScrollLines is how many lines one wheel notch moves.
const wheelScrollLines = 3

func (m Model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	switch msg.Button {
	case tea.MouseButtonLeft, tea.MouseButtonRight:
		if msg.Action != tea.MouseActionPress {
			return m, nil // drag motion and release never move the cursor
		}
		// A bare right-click is reserved. The right button is accepted only as
		// a safety net for terminals that map a physical Ctrl+click to it
		// while still forwarding the Ctrl modifier.
		if msg.Button == tea.MouseButtonRight && !msg.Ctrl {
			return m, nil
		}
		next, cmd, hit := m.handleEditClick(msg)
		if hit && msg.Ctrl {
			jumped, jumpCmd := next.jumpToReference()
			return jumped, tea.Batch(cmd, jumpCmd)
		}
		return next, cmd
	case tea.MouseButtonWheelUp:
		return m.wheelScroll(-1)
	case tea.MouseButtonWheelDown:
		return m.wheelScroll(1)
	}
	return m, nil
}

// handleEditClick moves the edit cursor to the clicked cell and reports
// whether the click landed on the text area of the edit pane.
func (m Model) handleEditClick(msg tea.MouseMsg) (Model, tea.Cmd, bool) {
	if m.mode != modeEdit || m.openFile == nil {
		return m, nil, false
	}
	line, col, ok := m.editClickTarget(msg.X, msg.Y)
	if !ok {
		return m, nil, false
	}
	m.errText = "" // transient edit errors clear on interaction, like keys
	var cmd tea.Cmd
	m, cmd = m.flushBurst() // cursor move = burst boundary, like the arrow keys
	m.edit.clearSelection()
	m.edit.cy, m.edit.cx = line, col
	m.edit.clampCursor()
	m.recomputeEditSuggestions()
	return m, cmd, true
}

// wheelScroll applies one wheel notch: in edit mode the cursor moves (the
// viewport follows it), in view mode the file scrolls. Other modes are inert.
func (m Model) wheelScroll(dir int) (tea.Model, tea.Cmd) {
	switch {
	case m.mode == modeEdit && m.openFile != nil:
		var cmd tea.Cmd
		m, cmd = m.flushBurst()
		m.edit.move(0, dir*wheelScrollLines)
		m.recomputeEditSuggestions()
		return m, cmd
	case m.mode == modeView && m.openFile != nil:
		limit := len(m.fileLines)
		if limit == 0 {
			limit = len(strings.Split(m.openFile.Content, "\n"))
		}
		m.fileScrollY = input.Clamp(m.fileScrollY+dir*wheelScrollLines, 0, max(0, limit-1))
	}
	return m, nil
}

// editClickTarget translates a screen cell (x, y) into a buffer (line, col),
// reproducing the layout math of View()/renderFile: one header row plus the
// pane top border above the text; the sidebar, pane border, and line-number
// gutter to its left; the same cursor-follow vertical clamp; and the cursor
// line's horizontal window.
func (m Model) editClickTarget(x, y int) (int, int, bool) {
	lines := m.edit.lines
	total := len(lines)
	if total == 0 {
		return 0, 0, false
	}

	bodyHeight := max(3, m.height-4)
	bodyHeight = max(3, bodyHeight-strings.Count(m.renderStatusLine(), "\n"))
	sidebarWidth := input.Clamp(m.width/4, 14, max(14, m.width-24))
	mainWidth := max(3, m.width-sidebarWidth-1)
	paneWidth := mainWidth - 4
	fileHeight := max(1, (bodyHeight-2)-len(m.renderEditOverlay(paneWidth)))

	paneRow := y - 2 // header + pane top border
	if paneRow < 0 || paneRow >= fileHeight {
		return 0, 0, false
	}
	start := m.fileScrollY
	if m.edit.cy < start {
		start = m.edit.cy
	}
	if m.edit.cy >= start+fileHeight {
		start = m.edit.cy - fileHeight + 1
	}
	start = input.Clamp(start, 0, max(0, total-fileHeight))
	line := start + paneRow
	if line >= total {
		return 0, 0, false // pane background below the last line
	}

	gutterWidth := len(strconv.Itoa(max(total, fileHeight)))
	paneCol := x - (sidebarWidth + 1) // sidebar + pane left border
	if paneCol < 0 || paneCol >= paneWidth {
		return 0, 0, false
	}
	contentCol := max(0, paneCol-(gutterWidth+3)) // gutter click → column 0

	// Only the cursor line renders through a horizontal window
	// (renderEditLine); every other line starts at buffer column 0.
	off := 0
	if line == m.edit.cy {
		contentWidth := max(1, paneWidth-gutterWidth-3)
		if at := input.Clamp(m.edit.cx, 0, len([]rune(lines[line]))); at >= contentWidth {
			off = at - contentWidth + 1
		}
	}
	col := input.Clamp(off+contentCol, 0, len([]rune(lines[line])))
	return line, col, true
}
