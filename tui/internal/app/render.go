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
	return lipgloss.JoinVertical(lipgloss.Left, header, body, m.renderStatusLine())
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
		return withNotice(promptStyle.Render("@history")+" "+count+"   ↑/↓/←/→ scroll · shift+↑/↓ select · s search · esc back", m.notice)
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
			return promptStyle.Render("Permission:") + " " + m.aiPermission.Title + "   [y] allow · [n] reject"
		}
		return renderMultilineInput("@ai >", m.aiInput, m.aiInputCursor)
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
		return withNotice(line, m.notice)
	}
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
	return strings.Join(vp.Lines, "\n")
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
		} else if suggestions[i].Source == "cache" {
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
	return strings.Join(vp.Lines, "\n")
}

// responseViewportDims mirrors the width/height math in View for the result pane,
// so the key handler can clamp scroll against the real content size.
func (m Model) responseViewportDims() (int, int) {
	bodyHeight := max(3, m.height-4)
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
}

var segStyles = map[segStyleKey]lipgloss.Style{}

func segStyleFor(segment view.HighlightSegment) lipgloss.Style {
	key := segStyleKey{color: segment.Color, bold: segment.Bold, dim: segment.DimColor, underline: segment.Underline}
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

// renderMultilineInput renders a (possibly multi-line) input with a styled
// prompt on the first line and aligned continuation lines, placing the cursor on
// its line. promptText is unstyled (used for width); styling is applied here.
func renderMultilineInput(promptText, text string, cursor int) string {
	runes := []rune(text)
	cursor = input.Clamp(cursor, 0, len(runes))

	// Cursor line index + column from newline counting.
	lineIdx, col := 0, 0
	for i := 0; i < cursor; i++ {
		if runes[i] == '\n' {
			lineIdx++
			col = 0
		} else {
			col++
		}
	}

	lines := strings.Split(text, "\n")
	indent := strings.Repeat(" ", len([]rune(promptText))+1)
	out := make([]string, len(lines))
	for i, ln := range lines {
		lead := indent
		if i == 0 {
			lead = promptStyle.Render(promptText) + " "
		}
		if i == lineIdx {
			out[i] = lead + renderInputLine(ln, col)
		} else {
			out[i] = lead + ln
		}
	}
	return strings.Join(out, "\n")
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
	// Reserve space for the `/command` popup at the bottom of the modal.
	popup := m.renderAiCommandSuggestions(width)
	transcriptHeight := max(1, height-len(popup))

	pendingFrame := -1
	if m.aiThinking {
		pendingFrame = m.aiThinkingFrame
	}
	agent := agentDisplayName(m.config.AIAdaptor)
	lines := view.BuildVisibleAiMessageLines(m.aiMessages, transcriptHeight, width, m.aiScrollY, pendingFrame, m.aiOffline, agent)

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

func colorFor(name string) lipgloss.Color {
	switch name {
	case "red":
		return lipgloss.Color("1")
	case "green":
		return lipgloss.Color("2")
	case "yellow":
		return lipgloss.Color("3")
	case "blue":
		return lipgloss.Color("4")
	case "magenta":
		return lipgloss.Color("5")
	case "cyan":
		return lipgloss.Color("6")
	case "white":
		return lipgloss.Color("7")
	case "gray":
		return lipgloss.Color("8")
	default:
		return lipgloss.Color("")
	}
}

var (
	headerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))
	paneStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder())
	promptStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Bold(true)
	cursorStyle = lipgloss.NewStyle().Reverse(true)
	gutterStyle = lipgloss.NewStyle().Faint(true)

	selectedEntryStyle = lipgloss.NewStyle().Reverse(true)
	dirStyle           = lipgloss.NewStyle().Foreground(lipgloss.Color("12")).Bold(true)
	requestStyle       = lipgloss.NewStyle()
	fileStyle          = lipgloss.NewStyle().Faint(true)

	searchMatchStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("7"))
	searchFocusedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("3")).Bold(true)
	selectionStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("4"))

	aiUserStyle          = lipgloss.NewStyle().Bold(true)
	suggestionStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("8"))
	suggestionFileStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	suggestionCacheStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	previewStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	noticeStyle          = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	editingStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Bold(true) // yellow: unsaved edits
	savedStyle           = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Bold(true) // green: in sync with disk
	editErrStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true) // red: transient edit-mode error
	aiModalStyle         = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("11"))

	sessionTitleStyle    = lipgloss.NewStyle().Bold(true)
	sessionHintStyle     = lipgloss.NewStyle().Faint(true)
	sessionSelectedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Background(lipgloss.Color("22")).Bold(true)
	overlayHintStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Bold(true)
)
