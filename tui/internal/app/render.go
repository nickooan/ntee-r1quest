package app

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/command"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

func (m Model) View() string {
	if !m.ready {
		return "starting…"
	}

	header := headerStyle.Width(m.width).Render(
		fmt.Sprintf("ntee-r1quest %s  ·  root: %s", m.config.Version, m.config.Root),
	)

	bodyHeight := max(3, m.height-4)

	// AI mode is a centered modal over a blank body, matching the Ink overlay.
	// Before the chat, the session picker takes the modal slot. The body shrinks
	// to make room for a multi-line input so the layout never overflows.
	if m.mode == modeAI {
		status := m.renderStatusLine()
		aiBodyHeight := max(3, m.height-3-strings.Count(status, "\n"))
		modal := m.renderAIModal(aiBodyHeight)
		if m.aiPicking {
			modal = m.renderSessionPicker()
		}
		body := lipgloss.Place(
			m.width, aiBodyHeight,
			lipgloss.Center, lipgloss.Center,
			modal,
		)
		return lipgloss.JoinVertical(lipgloss.Left, header, body, status)
	}

	// The status line can span multiple rows (query shows a hint row beneath the
	// input); shrink the body by those extra rows so the layout never overflows.
	status := m.renderStatusLine()
	bodyHeight = max(3, bodyHeight-strings.Count(status, "\n"))

	sidebarWidth := input.Clamp(m.width/4, 14, max(14, m.width-24))
	mainWidth := max(3, m.width-sidebarWidth-1)

	// In search mode the sidebar tracks the mode search was entered from, so a
	// search over @history keeps showing the history list (not the file tree).
	sidebarMode := m.mode
	if m.mode == modeSearch {
		sidebarMode = m.searchPrevMode
	}

	var sidebarBody string
	if sidebarMode == modeHistory {
		sidebarBody = m.renderHistorySidebar(sidebarWidth-4, bodyHeight-2)
	} else {
		sidebarBody = m.renderSidebar(sidebarWidth-4, bodyHeight-2)
	}
	sidebar := paneStyle.Width(sidebarWidth - 2).Height(bodyHeight - 2).Render(sidebarBody)

	var mainBody string
	switch m.mode {
	case modeView, modeEdit:
		mainBody = m.renderFile(mainWidth-4, bodyHeight-2)
	case modeHistory:
		mainBody = m.renderHistory(mainWidth-4, bodyHeight-2)
	case modeSearch:
		mainBody = m.renderSearch(mainWidth-4, bodyHeight-2)
	default:
		if m.pendingViewFile != "" || m.messageOverlay != "" {
			mainBody = m.renderQueryOverlay(mainWidth-4, bodyHeight-2)
		} else {
			mainBody = m.renderQueryMain(mainWidth-4, bodyHeight-2)
		}
	}
	mainPane := paneStyle.Width(mainWidth - 2).Height(bodyHeight - 2).Render(mainBody)

	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebar, mainPane)
	return lipgloss.JoinVertical(lipgloss.Left, header, body, status)
}

func (m Model) renderStatusLine() string {
	switch m.mode {
	case modeView:
		name := ""
		if m.openFile != nil {
			name = m.openFile.FileName
		}
		return withNotice(promptStyle.Render("@view")+" "+name+"   ↑/↓ scroll · e edit · s search · esc back", m.notice)
	case modeEdit:
		name := ""
		if m.openFile != nil {
			name = m.openFile.FileName
		}
		// State badge: yellow "editing" while there are unsaved changes, green
		// "saved" once the buffer matches disk (right after Ctrl+S). Any edit
		// flips it back to "editing".
		state := savedStyle.Render("saved")
		if m.edit.dirty {
			state = editingStyle.Render("editing")
		}
		line := promptStyle.Render("@edit") + " " + name + "   " + state +
			"   Ctrl+S save · Ctrl+F find · Ctrl+J/O jump/back · Ctrl+Z undo · esc discard"
		if m.errText != "" {
			// Transient errors (failed save, failed jump) — cleared on the
			// next keystroke by handleEditKey.
			line += "   " + editErrStyle.Render(m.errText)
		}
		return line
	case modeHistory:
		count := fmt.Sprintf("%d/%d", min(m.historyIndex+1, len(m.history)), len(m.history))
		return withNotice(promptStyle.Render("@history")+" "+count+"   ↑/↓/←/→ scroll · shift+↑/↓ select · s search · esc back   "+modeSwitchHint(m.mode), m.notice)
	case modeSearch:
		matches := view.FindSearchMatches(m.searchContent, m.searchInput)
		summary := fmt.Sprintf("%d matches", len(matches))
		if len(matches) > 0 {
			summary = fmt.Sprintf("%d/%d", min(m.searchFocused+1, len(matches)), len(matches))
		}
		return promptStyle.Render("@search /") + m.searchInput + "/   " + summary + "   ↑/↓ next · esc back"
	case modeAI:
		if m.aiPicking {
			return promptStyle.Render("@ai") + " resume session   ↑/↓ choose · enter confirm · esc cancel"
		}
		if m.aiPermission != nil {
			return m.renderPermissionBanner()
		}
		// Input on the top row, key hints on a faint row beneath it (the AI
		// layout accounts for the extra line via the status line's height).
		input := renderMultilineInput("@ai >", m.aiInput, m.aiInputCursor, aiInputWrapWidth(m.width), m.aiSel)
		hint := gutterStyle.Render("Ctrl+J newline · enter send · shift+↑/↓ scroll · esc back · " + modeSwitchHint(m.mode))
		// Notices (e.g. @copy's "copied") ride the hint row so they are
		// visible in AI mode without adding a screen row.
		return input + "\n" + withNotice(hint, m.notice)
	default:
		// While navigating (shift+arrow / popup), the input bar reflects the
		// selected entry; typing returns to the editable typed command.
		line := promptStyle.Render("@query >") + " "
		if m.commandPreview != "" {
			// Keep a visible cursor on the preview so the user can keep typing.
			line += previewStyle.Render(m.commandPreview) + cursorStyle.Render(" ")
		} else {
			line += renderInputLine(m.command, m.cursor)
		}
		// Mode-switch hint on its own faint row beneath the input, so it never
		// crowds what the user is typing.
		return withNotice(line, m.notice) + "\n" + gutterStyle.Render(modeSwitchHint(m.mode))
	}
}

// renderPermissionBanner renders a pending tool-permission request as a loud
// three-row banner (terminals can't scale fonts, so prominence comes from a
// highlighted badge, bold title, and colored actions): a black-on-yellow
// "PERMISSION REQUEST" badge, the requested action in bold, and green
// [y] allow / red [n] reject.
func (m Model) renderPermissionBanner() string {
	width := max(1, m.width)
	badge := permissionBadgeStyle.Render(" ⚠ PERMISSION REQUEST ")
	title := permissionTitleStyle.Render(truncateRunes(" "+m.aiPermission.Title, width))
	actions := " " + permissionAllowStyle.Render("[y] allow") +
		gutterStyle.Render("  ·  ") + permissionRejectStyle.Render("[n] reject")
	return badge + "\n" + title + "\n" + actions
}

// modeSwitchHint is a compact "shift+tab → <next mode>" hint so the Shift+Tab
// cycle is discoverable from every primary mode. Returned unstyled, matching
// the other plain status-line hints (the AI line renders it faint alongside
// its own hints).
func modeSwitchHint(m mode) string {
	return "shift+tab → " + nextModeLabel(m)
}

// withNotice appends a transient status note (e.g. "copied") to a status line.
func withNotice(line, notice string) string {
	if notice == "" {
		return line
	}
	return line + "   " + noticeStyle.Render(notice)
}

func (m Model) renderSidebar(width, height int) string {
	// Expansion follows the confirmed command; the highlight follows the keyboard
	// selection (so navigating onto a directory highlights without expanding it).
	entries := filetree.BuildFileTreeEntries(
		m.config.Root,
		filetree.BuildExpandedDirectoryPaths(m.sidebarCommand()),
	)
	if len(entries) == 0 {
		return "(no requests)"
	}

	highlighted := filetree.ResolveHighlightedEntry(entries, m.highlightedSidebarCommand())
	vp := filetree.BuildFileTreeViewport(entries, height, 0, highlighted)

	lines := make([]string, 0, len(vp.Entries))
	for i, entry := range vp.Entries {
		label := filetree.FormatFileTreeEntryLabel(entry, width)
		if vp.SafeScrollY+i == highlighted {
			lines = append(lines, selectedEntryStyle.Render(label))
		} else {
			lines = append(lines, entryStyle(entry.Type).Render(label))
		}
	}
	return strings.Join(lines, "\n")
}

func entryStyle(entryType string) lipgloss.Style {
	switch entryType {
	case "directory":
		return dirStyle
	case "request":
		return requestStyle
	default:
		return fileStyle
	}
}

func (m Model) renderHistorySidebar(width, height int) string {
	if len(m.history) == 0 {
		return "(no cached requests)"
	}
	start := input.Clamp(m.historyIndex-height/2, 0, max(0, len(m.history)-height))
	end := min(start+height, len(m.history))

	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		endpoint := m.history[i].Endpoint
		// Under a trace filter the same endpoint can repeat, so prefix the 1-based
		// call order to keep rows distinct and show the sequence.
		if m.historyTraceFilter != "" {
			endpoint = fmt.Sprintf("%d. %s", i+1, endpoint)
		}
		label := padTo(truncateRunes(endpoint, width), width)
		if i == m.historyIndex {
			lines = append(lines, selectedEntryStyle.Render(label))
		} else {
			lines = append(lines, label)
		}
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderHistory(width, height int) string {
	record, ok := m.currentHistoryRecord()
	if !ok {
		return "No cached requests yet.\n\nRun requests in @query mode to fill the history."
	}
	content := view.FormatHistoryEntry(record, width)
	vp := view.BuildTerminalViewport(content, width, height, m.historyScrollX, m.historyScrollY)
	rows := make([]string, 0, len(vp.Lines))
	for _, line := range vp.Lines {
		rows = append(rows, renderHighlighted(line, "response", width))
	}
	return strings.Join(rows, "\n")
}

func (m Model) renderSearch(width, height int) string {
	matches := view.FindSearchMatches(m.searchContent, m.searchInput)
	byLine := view.BuildMatchesByLine(matches)
	lines := strings.Split(m.searchContent, "\n")

	maxScrollY := max(0, len(lines)-height)
	start := 0
	off := 0
	if len(matches) > 0 && m.searchFocused < len(matches) {
		fm := matches[m.searchFocused]
		start = input.Clamp(fm.LineIndex-2, 0, maxScrollY)
		// Scroll horizontally so a focused match past the width is visible.
		fline := lines[fm.LineIndex]
		fcol := utf8.RuneCountInString(fline[:clampByte(fm.Start, len(fline))])
		if fcol >= width {
			off = max(0, fcol-width/2)
		}
	}

	rows := make([]string, 0, height)
	for i := start; i < start+height; i++ {
		if i >= len(lines) {
			rows = append(rows, "")
			continue
		}
		rows = append(rows, renderSearchLine(lines[i], byLine[i], m.searchFocused, off, width))
	}
	return strings.Join(rows, "\n")
}

// renderSearchLine draws one content line for the search view, slicing a
// width-wide window starting at rune column off (so a horizontally-scrolled
// focused match stays visible) and highlighting matches within it. Works in
// rune space throughout — content lines carry multi-byte runes (e.g. the ─
// box-drawing chars in dividers) and a byte cut would split one, rendering as �.
// Match offsets are byte positions into the original line, converted to rune
// columns here.
func renderSearchLine(line string, matches []view.LineMatch, focused, off, width int) string {
	if width < 1 {
		width = 1
	}
	runes := []rune(line)
	n := len(runes)
	end := min(off+width, n)

	type mrange struct {
		start, end int
		focused    bool
	}
	mr := make([]mrange, 0, len(matches))
	for _, lm := range matches {
		s := utf8.RuneCountInString(line[:clampByte(lm.Start, len(line))])
		e := utf8.RuneCountInString(line[:clampByte(lm.End, len(line))])
		mr = append(mr, mrange{s, e, lm.MatchIndex == focused})
	}

	var b strings.Builder
	for col := 0; col < width; col++ {
		idx := off + col
		ch := " "
		if idx < end {
			ch = string(runes[idx])
		}
		styled := false
		if idx < end {
			for _, r := range mr {
				if idx >= r.start && idx < r.end {
					style := searchMatchStyle
					if r.focused {
						style = searchFocusedStyle
					}
					b.WriteString(style.Render(ch))
					styled = true
					break
				}
			}
		}
		if !styled {
			b.WriteString(ch)
		}
	}
	return b.String()
}

// clampByte clamps a byte offset into [0, n].
func clampByte(i, n int) int {
	if i < 0 {
		return 0
	}
	if i > n {
		return n
	}
	return i
}

func padTo(s string, width int) string {
	if n := width - len([]rune(s)); n > 0 {
		return s + strings.Repeat(" ", n)
	}
	return s
}

// renderQueryMain renders the result pane, reserving the bottom rows for the
// input-suggestion popup (shown just above the @query line).
func (m Model) renderQueryMain(width, height int) string {
	overlay := m.renderCommandSuggestions(width)
	resultHeight := max(1, height-len(overlay))
	rows := []string{m.renderResponse(width, resultHeight)}
	rows = append(rows, overlay...)
	return strings.Join(rows, "\n")
}

func (m Model) renderCommandSuggestions(width int) []string {
	suggestions := m.queryInputSuggestions(m.treeEntries())
	if len(suggestions) == 0 {
		return nil
	}

	const maxVisible = 6
	selected := input.Clamp(m.inputSuggestIndex, 0, len(suggestions)-1)
	start := 0
	if selected >= maxVisible {
		start = selected - maxVisible + 1
	}
	end := min(start+maxVisible, len(suggestions))

	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		label := padTo(truncateRunes(" "+suggestions[i].Label, width), width)
		if i == selected {
			lines = append(lines, selectedEntryStyle.Render(label))
		} else if suggestions[i].Recent {
			// Cache rows and file entries that absorbed a duplicate cache row —
			// recently called either way, so both keep the cache color.
			lines = append(lines, suggestionCacheStyle.Render(label))
		} else {
			lines = append(lines, suggestionFileStyle.Render(label))
		}
	}
	return lines
}

func (m Model) renderResponse(width, height int) string {
	content := m.responseContent(width)
	vp := view.BuildTerminalViewport(content, width, height, m.scrollX, m.scrollY)
	rows := make([]string, 0, len(vp.Lines))
	for _, line := range vp.Lines {
		rows = append(rows, renderHighlighted(line, "response", width))
	}
	return strings.Join(rows, "\n")
}

// responseViewportDims mirrors the width/height math in View for the result pane,
// so the key handler can clamp scroll against the real content size.
func (m Model) responseViewportDims() (int, int) {
	bodyHeight := max(3, m.height-4)
	// Mirror View: the status line can span multiple rows (query mode adds a
	// hint row beneath the input) and the body shrinks by those extra rows.
	// Without this the scroll clamp is computed against a pane one row taller
	// than what is rendered, leaving the last line(s) unreachable.
	bodyHeight = max(3, bodyHeight-strings.Count(m.renderStatusLine(), "\n"))
	sidebarWidth := input.Clamp(m.width/4, 14, max(14, m.width-24))
	mainWidth := max(3, m.width-sidebarWidth-1)
	return mainWidth - 4, bodyHeight - 2
}

func (m *Model) refreshResponseScrollLimits() {
	width, height := m.responseViewportDims()
	if width < 1 || height < 1 {
		m.lastMaxScrollX, m.lastMaxScrollY = 0, 0
		return
	}
	vp := view.BuildTerminalViewport(m.responseContent(width), width, height, 0, 0)
	m.lastMaxScrollX = vp.MaxScrollX
	m.lastMaxScrollY = vp.MaxScrollY
}

func (m Model) responseContent(width int) string {
	switch {
	case m.pending:
		return "pending…"
	case m.errText != "":
		return view.FormatError(errString(m.errText), width)
	case m.external != "":
		return m.external
	case m.response != nil:
		return view.FormatExecuteResult(*m.response, width)
	default:
		return "Type a request path and press Enter, or browse with ↑/↓."
	}
}

func (m Model) renderFile(width, height int) string {
	var lines []string
	editing := m.mode == modeEdit
	if editing {
		lines = m.edit.lines
	} else if m.openFile != nil {
		// Cached by refreshFileHighlights; fall back defensively if a path
		// missed the refresh.
		lines = m.fileLines
		if lines == nil {
			lines = strings.Split(m.openFile.Content, "\n")
		}
	}
	if len(lines) == 0 {
		return ""
	}

	overlay := m.renderEditOverlay(width)
	fileHeight := max(1, height-len(overlay))

	graphql := m.graphqlLines
	if graphql == nil {
		graphql = view.BuildGraphqlHighlightLines(lines)
	}
	gutterWidth := len(strconv.Itoa(max(len(lines), fileHeight)))
	contentWidth := max(1, width-gutterWidth-3)

	start := m.fileScrollY
	if editing {
		// Keep the cursor line in view.
		if m.edit.cy < start {
			start = m.edit.cy
		}
		if m.edit.cy >= start+fileHeight {
			start = m.edit.cy - fileHeight + 1
		}
	}
	start = input.Clamp(start, 0, max(0, len(lines)-fileHeight))

	rows := make([]string, 0, height)
	for i := start; i < start+fileHeight; i++ {
		if i >= len(lines) {
			rows = append(rows, "")
			continue
		}
		number := gutterStyle.Render(pad(strconv.Itoa(i+1), gutterWidth) + " │ ")
		lang := "r1quest"
		if graphql[i] {
			lang = "graphql"
		}
		var content string
		if editing && i == m.edit.cy {
			content = renderEditLine(lines[i], m.edit.cx, contentWidth, m.edit.sel)
		} else {
			content = renderHighlighted(lines[i], lang, contentWidth)
		}
		rows = append(rows, number+content)
	}
	rows = append(rows, overlay...)
	return strings.Join(rows, "\n")
}

// renderEditOverlay renders the completion list (up to a few items) shown at the
// bottom of the edit pane.
func (m Model) renderEditOverlay(width int) []string {
	if m.mode != modeEdit || !m.editOverlayOpen() {
		return nil
	}
	const maxItems = 6
	items := m.editSuggestions

	start := 0
	if m.editSuggestIndex >= maxItems {
		start = m.editSuggestIndex - maxItems + 1
	}
	end := min(start+maxItems, len(items))

	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		rowStyle := suggestionStyle
		if i == m.editSuggestIndex {
			rowStyle = selectedEntryStyle
		}

		// Right-align a faint kind tag (macro/header/definition/...) when it
		// fits — several pools emit visually identical labels that differ only
		// by kind. Narrow panes fall back to the label-only row.
		row := " " + items[i].Label
		if kind := items[i].Kind; kind != "" {
			if pad := width - utf8.RuneCountInString(row) - len(kind) - 1; pad >= 2 {
				lines = append(lines, rowStyle.Render(row+strings.Repeat(" ", pad))+
					rowStyle.Faint(true).Render(kind+" "))
				continue
			}
		}
		lines = append(lines, rowStyle.Render(padTo(truncateRunes(row, width), width)))
	}
	return lines
}

// segStyles memoizes lipgloss styles per (color, bold, dim) combination —
// renderHighlighted runs for every visible row on every frame, and the style
// set is tiny. The TUI render loop is single-goroutine, so a plain map is safe.
type segStyleKey struct {
	color     string
	bold      bool
	dim       bool
	underline bool
	italic    bool
	strike    bool
}

var segStyles = map[segStyleKey]lipgloss.Style{}

func segStyleFor(segment view.HighlightSegment) lipgloss.Style {
	key := segStyleKey{
		color:     segment.Color,
		bold:      segment.Bold,
		dim:       segment.DimColor,
		underline: segment.Underline,
		italic:    segment.Italic,
		strike:    segment.Strike,
	}
	if style, ok := segStyles[key]; ok {
		return style
	}

	style := lipgloss.NewStyle()
	if key.color != "" {
		style = style.Foreground(colorFor(key.color))
	}
	if key.bold {
		style = style.Bold(true)
	}
	if key.dim {
		style = style.Faint(true)
	}
	if key.underline {
		style = style.Underline(true)
	}
	if key.italic {
		style = style.Italic(true)
	}
	if key.strike {
		style = style.Strikethrough(true)
	}
	segStyles[key] = style
	return style
}

func renderHighlighted(line, lang string, width int) string {
	truncated := truncateRunes(line, width)
	segments := view.HighlightLine(truncated, lang)

	var b strings.Builder
	rendered := 0
	for _, segment := range segments {
		b.WriteString(segStyleFor(segment).Render(segment.Text))
		rendered += utf8.RuneCountInString(segment.Text)
	}
	if pad := width - rendered; pad > 0 {
		b.WriteString(strings.Repeat(" ", pad))
	}
	return b.String()
}

// renderEditLine draws the cursor line, scrolling horizontally so the cursor
// stays visible when the line is longer than width: it slices a width-wide
// window that follows the cursor (offset = cx-width+1 once cx reaches the edge)
// and draws the cursor at its in-window column. An active selection (sel, in
// full-line rune columns) is highlighted where it intersects the window.
func renderEditLine(line string, cx, width int, sel *selRange) string {
	if width < 1 {
		width = 1
	}
	runes := []rune(line)
	n := len(runes)
	at := input.Clamp(cx, 0, n)

	off := 0
	if at >= width {
		off = at - width + 1 // keep the cursor at the right edge once past it
	}
	end := min(off+width, n)
	curCol := at - off // guaranteed within [0, width-1]

	selS, selE := -1, -1
	if sel != nil {
		s, e := sel.start, sel.end
		if s > e {
			s, e = e, s
		}
		selS = input.Clamp(s, off, end) - off
		selE = input.Clamp(e, off, end) - off
	}

	var b strings.Builder
	for col := 0; col < width; col++ {
		idx := off + col
		ch := " "
		if idx < end {
			ch = string(runes[idx])
		}
		switch {
		case col == curCol:
			b.WriteString(cursorStyle.Render(ch))
		case selS >= 0 && col >= selS && col < selE:
			b.WriteString(selectionStyle.Render(ch))
		default:
			b.WriteString(ch)
		}
	}
	return b.String()
}

// aiInputIndent is the column where AI input text begins: the "@ai >" prompt
// plus one space, matched by the continuation-row indent. The mouse click
// mapping in mouse.go relies on it.
const aiInputIndent = 6

// aiInputWrapWidth is the soft-wrap width of the AI input at terminal width w:
// the indent is subtracted and one cell is reserved for the end-of-row cursor
// so the terminal never auto-wraps. Single source of truth for the renderer,
// the ↑/↓ cursor movement, and the mouse click mapping.
func aiInputWrapWidth(w int) int { return max(1, w-aiInputIndent-1) }

// renderMultilineInput renders a (possibly multi-line) input with a styled
// prompt on the first row and aligned continuation rows, soft-wrapping each
// logical line at wrapWidth so long input grows downward instead of
// overflowing off-screen. Every emitted row is joined with a real '\n', so the
// status-height math (strings.Count) and the mouse geometry stay exact.
// promptText is unstyled (used for width); styling is applied here. An active
// sel range renders highlighted (across wrapped rows) instead of a cursor.
func renderMultilineInput(promptText, text string, cursor, wrapWidth int, sel *selRange) string {
	runes := []rune(text)
	cursor = input.Clamp(cursor, 0, len(runes))
	rows := input.WrapRows(text, wrapWidth)
	curRow, curCol := input.CursorRowCol(rows, cursor)

	indent := strings.Repeat(" ", len([]rune(promptText))+1)
	out := make([]string, len(rows))
	for i, r := range rows {
		lead := indent
		if i == 0 {
			lead = promptStyle.Render(promptText) + " "
		}
		switch {
		case sel != nil:
			out[i] = lead + renderSelectedRow(runes, r, *sel)
		case i == curRow:
			out[i] = lead + renderInputLine(string(runes[r.Start:r.End]), curCol)
		default:
			out[i] = lead + string(runes[r.Start:r.End])
		}
	}
	return strings.Join(out, "\n")
}

// renderSelectedRow renders one wrapped row with the part inside the selection
// range highlighted.
func renderSelectedRow(runes []rune, row input.WrapRow, sel selRange) string {
	s := input.Clamp(sel.start, row.Start, row.End)
	e := input.Clamp(sel.end, row.Start, row.End)
	if s >= e {
		return string(runes[row.Start:row.End])
	}
	return string(runes[row.Start:s]) + selectionStyle.Render(string(runes[s:e])) + string(runes[e:row.End])
}

func renderInputLine(text string, cursor int) string {
	runes := []rune(text)
	at := input.Clamp(cursor, 0, len(runes))
	before := string(runes[:at])
	cursorChar := " "
	after := ""
	if at < len(runes) {
		cursorChar = string(runes[at])
		after = string(runes[at+1:])
	}
	return before + cursorStyle.Render(cursorChar) + after
}

func (m Model) renderAIModal(bodyHeight int) string {
	modalWidth := input.Clamp(m.width*8/10, 24, max(24, m.width-4))
	modalHeight := input.Clamp(bodyHeight*9/10, 6, bodyHeight)
	inner := m.renderAI(modalWidth-2, modalHeight-2)
	return aiModalStyle.Width(modalWidth - 2).Height(modalHeight - 2).Render(inner)
}

// renderSessionPicker mirrors the Ink SessionPickerOverlay: "New session" on top
// then past sessions (newest-first) with their last-used time.
// renderQueryOverlay centers the confirm ("view this non-.nts file?") or the
// dismissible message (binary file) box in the query main pane.
func (m Model) renderQueryOverlay(width, height int) string {
	var title, hint string
	if m.pendingViewFile != "" {
		title = m.pendingViewFile + " is not a r1q executable (.nts) file."
		hint = "View it anyway?   [y] yes · [n] no"
	} else {
		title = m.messageOverlay
		hint = "[enter] dismiss"
	}

	boxWidth := input.Clamp(max(len([]rune(title)), len([]rune(hint)))+4, 20, max(20, width-2))
	box := aiModalStyle.Width(boxWidth).Render(
		sessionTitleStyle.Render(title) + "\n\n" + overlayHintStyle.Render(hint),
	)
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, box)
}

func (m Model) renderSessionPicker() string {
	const maxVisibleRows = 6
	modalWidth := input.Clamp(m.width*8/10, 28, max(28, m.width-4))
	contentWidth := max(1, modalWidth-4)

	type option struct{ label, hint string }
	options := []option{{label: "✚ New session"}}
	for _, s := range m.aiPickerSessions {
		options = append(options, option{label: s.ID, hint: formatSessionTime(s.UpdatedAt)})
	}

	visible := min(len(options), maxVisibleRows)
	start := input.Clamp(m.aiPickerIndex-visible+1, 0, max(0, len(options)-visible))

	var b strings.Builder
	b.WriteString(sessionTitleStyle.Render(padTo(truncateRunes("Resume "+agentDisplayName(m.config.AIAdaptor)+" session", contentWidth), contentWidth)) + "\n")
	b.WriteString(sessionHintStyle.Render(padTo(truncateRunes("↑/↓ choose · enter confirm · esc cancel", contentWidth), contentWidth)) + "\n\n")

	for i := start; i < start+visible; i++ {
		opt := options[i]
		prefix := "  "
		if i == m.aiPickerIndex {
			prefix = "› "
		}
		hint := ""
		if opt.hint != "" {
			hint = " " + opt.hint
		}
		labelWidth := max(1, contentWidth-len([]rune(prefix))-len([]rune(hint)))
		row := padTo(truncateRunes(prefix+padTo(truncateRunes(opt.label, labelWidth), labelWidth)+hint, contentWidth), contentWidth)
		if i == m.aiPickerIndex {
			b.WriteString(sessionSelectedStyle.Render(row))
		} else {
			b.WriteString(row)
		}
		if i < start+visible-1 {
			b.WriteString("\n")
		}
	}
	return aiModalStyle.Width(contentWidth).Render(b.String())
}

// formatSessionTime renders an ISO timestamp as "YYYY-MM-DD HH:mm".
func formatSessionTime(iso string) string {
	if len(iso) >= 16 {
		return strings.Replace(iso[:16], "T", " ", 1)
	}
	return iso
}

func (m Model) renderAI(width, height int) string {
	// Reserve space for the popup at the bottom of the modal; the #reference
	// popup takes precedence over the `/command` one. Queued mid-turn tips
	// (non-steering adapters) render as pinned rows just above the popup.
	popup := m.renderAiRefSuggestions(width)
	if len(popup) == 0 {
		popup = m.renderAiCommandSuggestions(width)
	}
	queueRows := m.renderAiQueuedTips(width)
	popup = append(queueRows, popup...)
	transcriptHeight := max(1, height-len(popup))

	pendingFrame := -1
	if m.aiThinking {
		pendingFrame = m.aiThinkingFrame
	}
	agent := agentDisplayName(m.config.AIAdaptor)
	// Freshly resumed session: show just the tail of the replayed history in
	// the top ~30% of the pane (divider last), leaving the rest clear for the
	// new conversation instead of a wall of history pinned to the bottom.
	buildHeight := transcriptHeight
	if m.aiHistoryAnchor && m.aiScrollY == 0 {
		buildHeight = max(1, transcriptHeight*3/10)
	}
	lines := view.BuildVisibleAiMessageLines(m.aiMessages, buildHeight, width, m.aiScrollY, pendingFrame, m.aiOffline, agent)

	rows := make([]string, 0, len(lines)+len(popup))
	for _, line := range lines {
		switch {
		case line.Segments != nil:
			rows = append(rows, renderAiSegments(line.Segments))
		case line.Role == "user":
			rows = append(rows, aiUserStyle.Render(line.Content))
		case line.Role == "divider" || line.Role == "status":
			rows = append(rows, gutterStyle.Render(line.Content))
		default:
			rows = append(rows, line.Content)
		}
	}
	if len(rows) == 0 && len(popup) == 0 {
		return "Ask the agent something and press Enter."
	}
	// Pin the popup to the bottom of the modal (just above the input) by padding
	// the transcript area to fill the reserved height.
	if len(popup) > 0 {
		for len(rows) < transcriptHeight {
			rows = append(rows, "")
		}
		rows = append(rows, popup...)
	}
	return strings.Join(rows, "\n")
}

// renderAiSegments renders a pre-wrapped AI chat line from its styled
// segments (padding to width is already baked into the segments).
func renderAiSegments(segments []view.HighlightSegment) string {
	var b strings.Builder
	for _, segment := range segments {
		b.WriteString(segStyleFor(segment).Render(segment.Text))
	}
	return b.String()
}

// renderAiQueuedTips renders the mid-turn messages waiting on a non-steering
// adapter: faint pinned rows above the input, moved into the transcript when
// the turn completes and they are actually sent. Capped so a big queue can't
// eat the modal.
func (m Model) renderAiQueuedTips(width int) []string {
	if len(m.aiQueue) == 0 {
		return nil
	}

	const maxVisible = 3
	visible := min(len(m.aiQueue), maxVisible)
	lines := make([]string, 0, visible+1)
	for _, q := range m.aiQueue[:visible] {
		text, _, _ := strings.Cut(q.Display, "\n")
		label := padTo(truncateRunes(" ⏳ queued: "+text, width), width)
		lines = append(lines, gutterStyle.Render(label))
	}
	if rest := len(m.aiQueue) - visible; rest > 0 {
		label := padTo(truncateRunes(fmt.Sprintf(" … +%d more", rest), width), width)
		lines = append(lines, gutterStyle.Render(label))
	}
	return lines
}

// renderAiRefSuggestions renders the `#keyword` reference popup: files and
// directories fuzzy-matched from the request root, shown with their full
// relative paths.
func (m Model) renderAiRefSuggestions(width int) []string {
	ref, ok := m.activeAiRef()
	if !ok {
		return nil
	}

	const maxVisible = 6
	selected := input.Clamp(m.aiRefSuggestIndex, 0, len(ref.matches)-1)
	start := 0
	if selected >= maxVisible {
		start = selected - maxVisible + 1
	}
	end := min(start+maxVisible, len(ref.matches))

	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		entry := ref.matches[i]
		label := padTo(truncateRunes(" "+entry.CommandValue, width), width)
		switch {
		case i == selected:
			lines = append(lines, selectedEntryStyle.Render(label))
		case entry.Type == "directory":
			lines = append(lines, suggestionStyle.Render(label))
		default:
			lines = append(lines, suggestionFileStyle.Render(label))
		}
	}
	return lines
}

// renderAiCommandSuggestions renders the `/command` popup (custom AI commands)
// matching the current AI input.
func (m Model) renderAiCommandSuggestions(width int) []string {
	matches := command.MatchCustomCommands(m.config.CustomCommands, m.aiInput)
	if len(matches) == 0 {
		return nil
	}

	const maxVisible = 6
	selected := input.Clamp(m.aiSuggestIndex, 0, len(matches)-1)
	start := 0
	if selected >= maxVisible {
		start = selected - maxVisible + 1
	}
	end := min(start+maxVisible, len(matches))

	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		label := "/" + matches[i].Name
		if matches[i].Description != "" {
			label += "  " + matches[i].Description
		}
		label = padTo(truncateRunes(" "+label, width), width)
		if i == selected {
			lines = append(lines, selectedEntryStyle.Render(label))
		} else {
			lines = append(lines, suggestionStyle.Render(label))
		}
	}
	return lines
}

func truncateRunes(s string, width int) string {
	// Byte length ≤ width implies rune count ≤ width — skip the []rune alloc
	// for the common short line.
	if len(s) <= width {
		return s
	}
	runes := []rune(s)
	if len(runes) > width {
		return string(runes[:width])
	}
	return s
}

func pad(s string, width int) string {
	if n := width - len([]rune(s)); n > 0 {
		return strings.Repeat(" ", n) + s
	}
	return s
}

// Gruvbox-dark palette, matching ntee-editor's color style. Truecolor hex;
// termenv degrades to 256 colors on lesser terminals.
var (
	colGruvFg        = lipgloss.Color("#ebdbb2") // cream
	colGruvBg        = lipgloss.Color("#282828")
	colGruvSelection = lipgloss.Color("#504945") // bg2
	colGruvSuggestBg = lipgloss.Color("#3c3836") // bg1
	colGruvBorder    = lipgloss.Color("#3c3836")
	colGruvGutter    = lipgloss.Color("#7c6f64") // bg4
	colGruvGray      = lipgloss.Color("#928374")
	colGruvRed       = lipgloss.Color("#fb4934")
	colGruvGreen     = lipgloss.Color("#b8bb26")
	colGruvYellow    = lipgloss.Color("#fabd2f")
	colGruvBlue      = lipgloss.Color("#83a598")
	colGruvPurple    = lipgloss.Color("#d3869b")
	colGruvAqua      = lipgloss.Color("#8ec07c")
	colGruvOrange    = lipgloss.Color("#fe8019")
)

// colorFor maps the highlighter's color names onto the gruvbox palette.
func colorFor(name string) lipgloss.Color {
	switch name {
	case "red":
		return colGruvRed
	case "green":
		return colGruvGreen
	case "yellow":
		return colGruvYellow
	case "blue":
		return colGruvBlue
	case "magenta":
		return colGruvPurple
	case "cyan":
		return colGruvAqua
	case "white":
		return colGruvFg
	case "gray":
		return colGruvGray
	default:
		return lipgloss.Color("")
	}
}

var (
	headerStyle = lipgloss.NewStyle().Bold(true).Foreground(colGruvAqua)
	paneStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colGruvBorder)
	promptStyle = lipgloss.NewStyle().Foreground(colGruvAqua).Bold(true)
	cursorStyle = lipgloss.NewStyle().Foreground(colGruvBg).Background(colGruvFg)
	gutterStyle = lipgloss.NewStyle().Foreground(colGruvGutter)

	selectedEntryStyle = lipgloss.NewStyle().Foreground(colGruvFg).Background(colGruvSelection)
	dirStyle           = lipgloss.NewStyle().Foreground(colGruvAqua).Bold(true)
	requestStyle       = lipgloss.NewStyle().Foreground(colGruvFg)
	fileStyle          = lipgloss.NewStyle().Foreground(colGruvGray)

	searchMatchStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#000000")).Background(colGruvYellow)
	searchFocusedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#000000")).Background(colGruvOrange).Bold(true)
	selectionStyle     = lipgloss.NewStyle().Foreground(colGruvFg).Background(colGruvSelection)

	aiUserStyle          = lipgloss.NewStyle().Bold(true)
	suggestionStyle      = lipgloss.NewStyle().Foreground(colGruvFg).Background(colGruvSuggestBg)
	suggestionFileStyle  = lipgloss.NewStyle().Foreground(colGruvYellow)
	suggestionCacheStyle = lipgloss.NewStyle().Foreground(colGruvGreen)
	previewStyle         = lipgloss.NewStyle().Foreground(colGruvAqua)
	noticeStyle          = lipgloss.NewStyle().Foreground(colGruvGreen)
	editingStyle         = lipgloss.NewStyle().Foreground(colGruvYellow).Bold(true) // unsaved edits
	savedStyle           = lipgloss.NewStyle().Foreground(colGruvGreen).Bold(true)  // in sync with disk
	editErrStyle         = lipgloss.NewStyle().Foreground(colGruvRed).Bold(true)    // transient edit-mode error
	aiModalStyle         = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colGruvGray)

	sessionTitleStyle    = lipgloss.NewStyle().Bold(true).Foreground(colGruvFg)
	sessionHintStyle     = lipgloss.NewStyle().Foreground(colGruvGray)
	sessionSelectedStyle = lipgloss.NewStyle().Foreground(colGruvFg).Background(colGruvSelection).Bold(true)
	overlayHintStyle     = lipgloss.NewStyle().Foreground(colGruvYellow).Bold(true)

	// Tool-permission banner: black-on-gold badge, bold title, green allow /
	// red reject actions.
	permissionBadgeStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#000000")).Background(colGruvYellow).Bold(true)
	permissionTitleStyle  = lipgloss.NewStyle().Bold(true).Foreground(colGruvFg)
	permissionAllowStyle  = lipgloss.NewStyle().Foreground(colGruvGreen).Bold(true)
	permissionRejectStyle = lipgloss.NewStyle().Foreground(colGruvRed).Bold(true)
)
