package app

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"

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
	sidebarWidth := input.Clamp(m.width/4, 14, max(14, m.width-24))
	mainWidth := max(3, m.width-sidebarWidth-1)

	var sidebarBody string
	if m.mode == modeHistory {
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
	case modeAI:
		mainBody = m.renderAI(mainWidth-4, bodyHeight-2)
	default:
		mainBody = m.renderResponse(mainWidth-4, bodyHeight-2)
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
		return promptStyle.Render("@view") + " " + name + "   ↑/↓ scroll · e edit · q back"
	case modeEdit:
		name := ""
		if m.openFile != nil {
			name = m.openFile.FileName
		}
		dirty := ""
		if m.edit.dirty {
			dirty = "*"
		}
		status := promptStyle.Render("@edit") + " " + name + dirty + "   ^S save · esc discard"
		if m.notice != "" {
			status += "   " + m.notice
		}
		return status
	case modeHistory:
		count := fmt.Sprintf("%d/%d", min(m.historyIndex+1, len(m.history)), len(m.history))
		return promptStyle.Render("@history") + " " + count + "   ↑/↓ select · / search · q back"
	case modeSearch:
		matches := view.FindSearchMatches(m.searchContent, m.searchInput)
		summary := fmt.Sprintf("%d matches", len(matches))
		if len(matches) > 0 {
			summary = fmt.Sprintf("%d/%d", min(m.searchFocused+1, len(matches)), len(matches))
		}
		return promptStyle.Render("@search /") + m.searchInput + "/   " + summary + "   ↑/↓ next · esc back"
	case modeAI:
		if m.aiPermission != nil {
			return promptStyle.Render("Permission:") + " " + m.aiPermission.Title + "   [y] allow · [n] reject"
		}
		return promptStyle.Render("@ai >") + " " + renderInputLine(m.aiInput, m.aiInputCursor)
	default:
		return promptStyle.Render("@query >") + " " + renderInputLine(m.command, m.cursor)
	}
}

func (m Model) renderSidebar(width, height int) string {
	command := filetree.ResolveSidebarCommand(m.command, m.selectedCommand)
	entries := filetree.BuildFileTreeEntries(m.config.Root, filetree.BuildExpandedDirectoryPaths(command))
	if len(entries) == 0 {
		return "(no requests)"
	}

	highlighted := filetree.ResolveHighlightedEntry(entries, command)
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
		label := padTo(truncateRunes(m.history[i].Endpoint, width), width)
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
	vp := view.BuildTerminalViewport(content, width, height, 0, 0)
	return strings.Join(vp.Lines, "\n")
}

func (m Model) renderSearch(width, height int) string {
	matches := view.FindSearchMatches(m.searchContent, m.searchInput)
	byLine := view.BuildMatchesByLine(matches)
	lines := strings.Split(m.searchContent, "\n")

	maxScrollY := max(0, len(lines)-height)
	start := 0
	if len(matches) > 0 && m.searchFocused < len(matches) {
		start = input.Clamp(matches[m.searchFocused].LineIndex-2, 0, maxScrollY)
	}

	rows := make([]string, 0, height)
	for i := start; i < start+height; i++ {
		if i >= len(lines) {
			rows = append(rows, "")
			continue
		}
		rows = append(rows, renderSearchLine(lines[i], byLine[i], m.searchFocused, width))
	}
	return strings.Join(rows, "\n")
}

func renderSearchLine(line string, matches []view.LineMatch, focused, width int) string {
	display := line
	if len(display) > width {
		display = display[:width]
	}
	if len(matches) == 0 {
		return padTo(display, width)
	}

	var b strings.Builder
	cursor := 0
	rendered := 0 // visible byte count (ASCII content); excludes ANSI
	for _, lm := range matches {
		start := lm.Start
		end := lm.End
		if start >= len(display) {
			break
		}
		if end > len(display) {
			end = len(display)
		}
		if start < cursor {
			start = cursor
		}
		if start > cursor {
			b.WriteString(display[cursor:start])
			rendered += start - cursor
		}
		if start < end {
			style := searchMatchStyle
			if lm.MatchIndex == focused {
				style = searchFocusedStyle
			}
			b.WriteString(style.Render(display[start:end]))
			rendered += end - start
		}
		cursor = end
	}
	if cursor < len(display) {
		b.WriteString(display[cursor:])
		rendered += len(display) - cursor
	}
	if pad := width - rendered; pad > 0 {
		b.WriteString(strings.Repeat(" ", pad))
	}
	return b.String()
}

func padTo(s string, width int) string {
	if n := width - len([]rune(s)); n > 0 {
		return s + strings.Repeat(" ", n)
	}
	return s
}

func (m Model) renderResponse(width, height int) string {
	content := m.responseContent(width)
	vp := view.BuildTerminalViewport(content, width, height, 0, m.scrollY)
	return strings.Join(vp.Lines, "\n")
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
		return view.FormatResponse(*m.response, "", width)
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
		lines = strings.Split(m.openFile.Content, "\n")
	}
	if len(lines) == 0 {
		return ""
	}

	graphql := view.BuildGraphqlHighlightLines(lines)
	gutterWidth := len(strconv.Itoa(max(len(lines), height)))
	contentWidth := max(1, width-gutterWidth-3)

	start := m.fileScrollY
	if editing {
		// Keep the cursor line in view.
		if m.edit.cy < start {
			start = m.edit.cy
		}
		if m.edit.cy >= start+height {
			start = m.edit.cy - height + 1
		}
	}
	start = input.Clamp(start, 0, max(0, len(lines)-height))

	rows := make([]string, 0, height)
	for i := start; i < start+height; i++ {
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
			content = renderEditLine(lines[i], m.edit.cx, contentWidth)
		} else {
			content = renderHighlighted(lines[i], lang, contentWidth)
		}
		rows = append(rows, number+content)
	}
	return strings.Join(rows, "\n")
}

func renderHighlighted(line, lang string, width int) string {
	truncated := truncateRunes(line, width)
	segments := view.HighlightLine(truncated, lang)

	var b strings.Builder
	rendered := 0
	for _, segment := range segments {
		style := lipgloss.NewStyle()
		if segment.Color != "" {
			style = style.Foreground(colorFor(segment.Color))
		}
		if segment.Bold {
			style = style.Bold(true)
		}
		if segment.DimColor {
			style = style.Faint(true)
		}
		b.WriteString(style.Render(segment.Text))
		rendered += len([]rune(segment.Text))
	}
	if pad := width - rendered; pad > 0 {
		b.WriteString(strings.Repeat(" ", pad))
	}
	return b.String()
}

func renderEditLine(line string, cx, width int) string {
	truncated := truncateRunes(line, width)
	runes := []rune(truncated)
	at := input.Clamp(cx, 0, len(runes))

	before := string(runes[:at])
	cursorChar := " "
	after := ""
	if at < len(runes) {
		cursorChar = string(runes[at])
		after = string(runes[at+1:])
	}
	rendered := len([]rune(before)) + 1 + len([]rune(after))
	out := before + cursorStyle.Render(cursorChar) + after
	if pad := width - rendered; pad > 0 {
		out += strings.Repeat(" ", pad)
	}
	return out
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

func (m Model) renderAI(width, height int) string {
	pendingFrame := -1
	if m.aiThinking {
		pendingFrame = 0
	}
	agent := agentDisplayName(m.config.AIAdaptor)
	lines := view.BuildVisibleAiMessageLines(m.aiMessages, height, width, m.aiScrollY, pendingFrame, m.aiOffline, agent)

	rows := make([]string, 0, len(lines))
	for _, line := range lines {
		switch line.Role {
		case "user":
			rows = append(rows, aiUserStyle.Render(line.Content))
		case "divider":
			rows = append(rows, gutterStyle.Render(line.Content))
		default:
			rows = append(rows, line.Content)
		}
	}
	if len(rows) == 0 {
		return "Ask the agent something and press Enter."
	}
	return strings.Join(rows, "\n")
}

func truncateRunes(s string, width int) string {
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

	aiUserStyle = lipgloss.NewStyle().Bold(true)
)
