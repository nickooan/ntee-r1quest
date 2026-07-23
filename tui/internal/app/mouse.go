package app

import (
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
)

// Mouse support, mirroring ntee-editor: a left click places the edit cursor on
// the clicked cell. Everything else — drags, releases, right clicks, other
// buttons — is deliberately inert, so a stray trackpad gesture never edits
// anything. Capture is only enabled while in edit mode (see Update), so native
// terminal text selection keeps working in the other modes.

func (m Model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	if msg.Button != tea.MouseButtonLeft || msg.Action != tea.MouseActionPress {
		return m, nil // drag motion, release, and other buttons never move the cursor
	}
	return m.handleEditClick(msg)
}

// handleEditClick moves the edit cursor to the clicked cell.
func (m Model) handleEditClick(msg tea.MouseMsg) (Model, tea.Cmd) {
	if m.mode != modeEdit || m.openFile == nil {
		return m, nil
	}
	line, col, ok := m.editClickTarget(msg.X, msg.Y)
	if !ok {
		return m, nil
	}
	m.errText = "" // transient edit errors clear on interaction, like keys
	var cmd tea.Cmd
	m, cmd = m.flushBurst() // cursor move = burst boundary, like the arrow keys
	m.edit.clearSelection()
	m.edit.cy, m.edit.cx = line, col
	m.edit.clampCursor()
	m.recomputeEditSuggestions()
	return m, cmd
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
