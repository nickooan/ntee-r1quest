package view

import (
	"encoding/json"
	"regexp"
	"strings"
)

// Ported from src/views/terminal/ai-layout.ts (message line building) and
// ai-session.ts (ACP update → chat messages, permission option resolution).

// ChatMessage mirrors key-helpers AiChatMessage.
type ChatMessage struct {
	Role       string // "user" | "assistant" | "tool" | "divider"
	Content    string // for "tool": the tool title
	ToolCallID string // "tool" only: dedupe key for tool_call_update
	ToolStatus string // "tool" only: "" | "pending" | "in_progress" | "completed" | "failed"
}

// AiLine is a rendered message line tagged with its role (for coloring). When
// Segments is non-nil the renderer draws each styled segment instead of the
// whole-line Content (which still holds the plain text).
type AiLine struct {
	Role     string
	Content  string
	Segments []HighlightSegment
}

var aiPendingFrames = []string{".", "..", "..."}

// ── ACP update → chat messages (ai-session.ts) ───────────────────────────────

type acpUpdate struct {
	SessionUpdate string `json:"sessionUpdate"`
	Content       *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Title      string `json:"title"`
	ToolCallID string `json:"toolCallId"`
	Status     string `json:"status"`
}

// AppendACPResponse folds one ACP SessionUpdate into the message list. Mirrors
// appendAcpResponse.
func AppendACPResponse(messages []ChatMessage, update json.RawMessage) []ChatMessage {
	var u acpUpdate
	if json.Unmarshal(update, &u) != nil {
		return messages
	}

	switch u.SessionUpdate {
	case "user_message_chunk":
		if u.Content != nil && u.Content.Type == "text" {
			if msg, ok := taskNotification(u.Content.Text); ok {
				return updateToolCall(messages, acpUpdate{ToolCallID: msg.ToolCallID, Status: msg.ToolStatus, Title: msg.Content})
			}
			return appendUserResponse(messages, u.Content.Text)
		}
	case "agent_message_chunk":
		if u.Content != nil && u.Content.Type == "text" {
			return appendAssistantResponse(messages, u.Content.Text)
		}
	case "tool_call":
		return appendToolCall(messages, u)
	case "tool_call_update":
		return updateToolCall(messages, u)
	}
	return messages
}

func appendToolCall(messages []ChatMessage, u acpUpdate) []ChatMessage {
	if u.Title == "" && u.ToolCallID == "" {
		return messages
	}
	return append(messages, ChatMessage{Role: "tool", Content: u.Title, ToolCallID: u.ToolCallID, ToolStatus: u.Status})
}

// updateToolCall folds a tool_call_update into the matching tool message (one
// line per tool call whose status/title mutate in place). An update with no
// matching id but a title lands as a fresh tool message.
func updateToolCall(messages []ChatMessage, u acpUpdate) []ChatMessage {
	if u.ToolCallID != "" {
		for i := len(messages) - 1; i >= 0; i-- {
			if messages[i].Role == "tool" && messages[i].ToolCallID == u.ToolCallID {
				out := append([]ChatMessage(nil), messages...)
				if u.Status != "" {
					out[i].ToolStatus = u.Status
				}
				if u.Title != "" {
					out[i].Content = u.Title
				}
				return out
			}
		}
	}
	if u.Title != "" {
		return append(messages, ChatMessage{Role: "tool", Content: u.Title, ToolCallID: u.ToolCallID, ToolStatus: u.Status})
	}
	return messages
}

func appendAssistantResponse(messages []ChatMessage, content string) []ChatMessage {
	if content == "" {
		return messages
	}
	if n := len(messages); n > 0 && messages[n-1].Role == "assistant" {
		out := append([]ChatMessage(nil), messages...)
		out[n-1].Content = joinAssistantChunk(out[n-1].Content, content)
		return out
	}
	return append(messages, ChatMessage{Role: "assistant", Content: content})
}

// joinAssistantChunk appends a streamed chunk to the running assistant message,
// starting a new line at a sentence/segment boundary so distinct responses don't
// run together — while mid-sentence streaming stays on one line.
func joinAssistantChunk(prev, next string) string {
	if prev == "" {
		return next
	}
	if strings.HasSuffix(prev, "\n") || strings.HasPrefix(next, "\n") {
		return prev + next
	}
	if endsSegment(prev) {
		return prev + "\n" + next
	}
	return prev + next
}

func endsSegment(s string) bool {
	trimmed := strings.TrimRight(s, " \t")
	runes := []rune(trimmed)
	if len(runes) == 0 {
		return false
	}
	switch runes[len(runes)-1] {
	case '.', '!', '?', ':', ']':
		return true
	}
	return false
}

func appendUserResponse(messages []ChatMessage, content string) []ChatMessage {
	if content == "" {
		return messages
	}
	// Ignore an identical consecutive user echo (live mode adds it locally).
	if n := len(messages); n > 0 && messages[n-1].Role == "user" && messages[n-1].Content == content {
		return messages
	}
	return append(messages, ChatMessage{Role: "user", Content: content})
}

// ── Background task notifications ────────────────────────────────────────────

// Claude Code injects background-task lifecycle events as synthetic user
// messages whose body is an XML-ish <task-notification> blob. We recognize it
// and render it as a friendly tool-style line instead of raw markup.

var taskTagPatterns = map[string]*regexp.Regexp{
	"summary":     regexp.MustCompile(`(?s)<summary>(.*?)</summary>`),
	"status":      regexp.MustCompile(`(?s)<status>(.*?)</status>`),
	"output-file": regexp.MustCompile(`(?s)<output-file>(.*?)</output-file>`),
	"tool-use-id": regexp.MustCompile(`(?s)<tool-use-id>(.*?)</tool-use-id>`),
	"task-id":     regexp.MustCompile(`(?s)<task-id>(.*?)</task-id>`),
}

// taskNotification parses a <task-notification> blob into a tool-style message.
// It returns ok=false for anything that isn't a complete notification, leaving
// the text to render as an ordinary user message.
func taskNotification(text string) (ChatMessage, bool) {
	if !strings.Contains(text, "<task-notification>") || !strings.Contains(text, "</task-notification>") {
		return ChatMessage{}, false
	}

	field := func(tag string) string {
		if m := taskTagPatterns[tag].FindStringSubmatch(text); m != nil {
			return strings.TrimSpace(m[1])
		}
		return ""
	}
	summary := field("summary")
	status := field("status")
	outputFile := field("output-file")

	headline := summary
	if headline == "" {
		headline = "Background task"
		if status != "" {
			headline += " " + status
		}
	}
	content := headline
	if outputFile != "" {
		content += "\noutput: " + outputFile
	}

	id := field("tool-use-id")
	if id == "" {
		id = field("task-id")
	}

	return ChatMessage{
		Role:       "tool",
		Content:    content,
		ToolCallID: id,
		ToolStatus: taskStatusToTool(status),
	}, true
}

// taskStatusToTool maps a notification status onto the tool status vocabulary
// consumed by buildToolLines (which colors the bullet green/yellow/red).
func taskStatusToTool(status string) string {
	switch strings.ToLower(status) {
	case "completed", "success", "done":
		return "completed"
	case "killed", "failed", "cancelled", "canceled", "error", "timeout":
		return "failed"
	case "running", "in_progress", "pending", "started":
		return "in_progress"
	default:
		return "completed"
	}
}

// ── Permission (ai-session.ts) ───────────────────────────────────────────────

// Permission is a parsed ACP tool-use approval request.
type Permission struct {
	Title   string
	Options []PermissionOption
}

// PermissionOption mirrors an ACP permission option.
type PermissionOption struct {
	OptionID string
	Kind     string
	Name     string
}

type acpPermission struct {
	ToolCall struct {
		Title string `json:"title"`
	} `json:"toolCall"`
	Options []struct {
		OptionID string `json:"optionId"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
	} `json:"options"`
}

// ParsePermission decodes a raw ACP permission request.
func ParsePermission(raw json.RawMessage) (Permission, bool) {
	var p acpPermission
	if json.Unmarshal(raw, &p) != nil {
		return Permission{}, false
	}
	permission := Permission{Title: p.ToolCall.Title}
	for _, o := range p.Options {
		permission.Options = append(permission.Options, PermissionOption{OptionID: o.OptionID, Kind: o.Kind, Name: o.Name})
	}
	if permission.Title == "" {
		permission.Title = "Allow AI agent action?"
	}
	return permission, true
}

// FindPermissionOptionID returns the option id for an allow/reject decision.
// Mirrors findPermissionOptionId.
func FindPermissionOptionID(p Permission, decision string) string {
	for _, o := range p.Options {
		if strings.HasPrefix(o.Kind, decision) {
			return o.OptionID
		}
	}
	return ""
}

// ── Message line building (ai-layout.ts) ─────────────────────────────────────

func aiSplitContent(content string) []string {
	return strings.Split(content, "\n")
}

func aiWrapLine(line string, width int) []string {
	if width <= 0 {
		return []string{line}
	}
	runes := []rune(line)
	if len(runes) == 0 {
		return []string{""}
	}
	var chunks []string
	for i := 0; i < len(runes); i += width {
		end := min(i+width, len(runes))
		chunks = append(chunks, string(runes[i:end]))
	}
	return chunks
}

func aiWrapLines(lines []string, width int) []string {
	var out []string
	for _, line := range lines {
		out = append(out, aiWrapLine(line, width)...)
	}
	return out
}

func buildMessageLines(message ChatMessage, width int, agentName string) []AiLine {
	switch message.Role {
	case "divider":
		label := " above is history "
		ruleWidth := max(0, width-len([]rune(label)))
		left := ruleWidth / 2
		right := ruleWidth - left
		line := strings.Repeat("─", left) + label + strings.Repeat("─", right)
		return []AiLine{{Role: "divider", Content: truncateRunesView(line, width)}}
	case "tool":
		return buildToolLines(message, width)
	case "user":
		return buildPrefixedLines(message, "USER: ", width)
	default:
		return buildAssistantLines(message, agentName+": ", width)
	}
}

// buildPrefixedLines is the plain path (user messages): a name prefix on the
// first line, continuation lines indented to align under it.
func buildPrefixedLines(message ChatMessage, prefix string, width int) []AiLine {
	contentWidth := max(1, width-len([]rune(prefix)))
	wrapped := aiWrapLines(aiSplitContent(message.Content), contentWidth)

	out := make([]AiLine, 0, len(wrapped))
	for i, line := range wrapped {
		lead := prefix
		if i > 0 {
			lead = strings.Repeat(" ", len([]rune(prefix)))
		}
		out = append(out, AiLine{Role: message.Role, Content: padRightView(lead+line, width)})
	}
	return out
}

// buildToolLines renders a tool call as a bulleted activity line: the bullet
// color tracks status (yellow=running, green=done, red=failed) and the title
// is de-emphasized in gray.
func buildToolLines(message ChatMessage, width int) []AiLine {
	bulletColor := "green"
	switch message.ToolStatus {
	case "pending", "in_progress":
		bulletColor = "yellow"
	case "failed":
		bulletColor = "red"
	}

	const prefix = "⏺ "
	contentWidth := max(1, width-len([]rune(prefix)))
	wrapped := aiWrapLines(aiSplitContent(message.Content), contentWidth)

	out := make([]AiLine, 0, len(wrapped))
	for i, line := range wrapped {
		lead := HighlightSegment{Text: prefix, Color: bulletColor}
		if i > 0 {
			lead = HighlightSegment{Text: strings.Repeat(" ", len([]rune(prefix)))}
		}
		segments := padSegments([]HighlightSegment{lead, {Text: line, Color: "gray"}}, width)
		out = append(out, AiLine{Role: "tool", Content: padRightView(lead.Text+line, width), Segments: segments})
	}
	return out
}

// buildAssistantLines renders agent prose with light markdown accents,
// wrapping styled segments so accents survive wrap boundaries.
func buildAssistantLines(message ChatMessage, prefix string, width int) []AiLine {
	prefixWidth := len([]rune(prefix))
	contentWidth := max(1, width-prefixWidth)
	indent := strings.Repeat(" ", prefixWidth)

	var out []AiLine
	inCodeBlock := false
	first := true
	for _, logical := range aiSplitContent(message.Content) {
		var segments []HighlightSegment
		segments, inCodeBlock = MarkdownLineSegments(logical, inCodeBlock)
		for _, row := range WrapSegments(segments, contentWidth) {
			lead := indent
			if first {
				lead = prefix
				first = false
			}
			lineSegments := padSegments(append([]HighlightSegment{{Text: lead}}, row...), width)
			plain := ""
			for _, segment := range lineSegments {
				plain += segment.Text
			}
			out = append(out, AiLine{Role: "assistant", Content: plain, Segments: lineSegments})
		}
	}
	return out
}

// padSegments appends spaces so the segments' total rune count reaches width.
func padSegments(segments []HighlightSegment, width int) []HighlightSegment {
	total := 0
	for _, segment := range segments {
		total += len([]rune(segment.Text))
	}
	if pad := width - total; pad > 0 {
		segments = append(segments, HighlightSegment{Text: strings.Repeat(" ", pad)})
	}
	return segments
}

// BuildAiMessageLines renders all messages into role-tagged lines. Mirrors
// buildAiMessageLines.
func BuildAiMessageLines(messages []ChatMessage, width int, agentName string) []AiLine {
	if agentName == "" {
		agentName = "AI"
	}
	var out []AiLine
	for mi, message := range messages {
		// Blank separator between turns for readability; consecutive tool lines
		// stay compact so tool activity reads as one block.
		if mi > 0 && !(message.Role == "tool" && messages[mi-1].Role == "tool") {
			out = append(out, AiLine{Role: "", Content: ""})
		}
		out = append(out, buildMessageLines(message, width, agentName)...)
	}
	return out
}

// BuildVisibleAiMessageLines renders the visible window of messages plus a
// trailing offline / thinking indicator. Mirrors buildVisibleAiMessageLines.
func BuildVisibleAiMessageLines(messages []ChatMessage, height, width, scrollY, pendingFrameIndex int, offline bool, agentName string) []AiLine {
	if agentName == "" {
		agentName = "AI"
	}
	lines := BuildAiMessageLines(messages, width, agentName)

	if offline {
		lines = append(lines, AiLine{Role: "status", Content: padLeftView(agentName+" is offline", width)})
	} else if pendingFrameIndex >= 0 {
		frame := aiPendingFrames[pendingFrameIndex%len(aiPendingFrames)]
		lines = append(lines, AiLine{Role: "status", Content: padLeftView(agentName+" is thinking"+frame, width)})
	}

	maxScrollY := max(0, len(lines)-height)
	safe := maxScrollY - min(max(scrollY, 0), maxScrollY)
	end := min(safe+height, len(lines))
	if safe > end {
		safe = end
	}
	return lines[safe:end]
}

func truncateRunesView(s string, width int) string {
	runes := []rune(s)
	if len(runes) > width {
		return string(runes[:width])
	}
	return s
}

func padRightView(s string, width int) string {
	if n := width - len([]rune(s)); n > 0 {
		return s + strings.Repeat(" ", n)
	}
	return s
}

func padLeftView(s string, width int) string {
	if n := width - len([]rune(s)); n > 0 {
		return strings.Repeat(" ", n) + s
	}
	return s
}
