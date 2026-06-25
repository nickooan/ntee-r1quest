package view

import (
	"encoding/json"
	"strings"
)

// Ported from src/views/terminal/ai-layout.ts (message line building) and
// ai-session.ts (ACP update → chat messages, permission option resolution).

// ChatMessage mirrors key-helpers AiChatMessage.
type ChatMessage struct {
	Role    string // "user" | "assistant" | "divider"
	Content string
}

// AiLine is a rendered message line tagged with its role (for coloring).
type AiLine struct {
	Role    string
	Content string
}

var aiPendingFrames = []string{".", "..", "..."}

// ── ACP update → chat messages (ai-session.ts) ───────────────────────────────

type acpUpdate struct {
	SessionUpdate string `json:"sessionUpdate"`
	Content       *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Title string `json:"title"`
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
			return appendUserResponse(messages, u.Content.Text)
		}
	case "agent_message_chunk":
		if u.Content != nil && u.Content.Type == "text" {
			return appendAssistantResponse(messages, u.Content.Text)
		}
	case "tool_call":
		return appendAssistantResponse(messages, "\n["+u.Title+"]")
	case "tool_call_update":
		if u.Title != "" {
			return appendAssistantResponse(messages, "\n["+u.Title+"]")
		}
	}
	return messages
}

func appendAssistantResponse(messages []ChatMessage, content string) []ChatMessage {
	if content == "" {
		return messages
	}
	if n := len(messages); n > 0 && messages[n-1].Role == "assistant" {
		out := append([]ChatMessage(nil), messages...)
		out[n-1].Content += content
		return out
	}
	return append(messages, ChatMessage{Role: "assistant", Content: content})
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

func buildMessageLines(message ChatMessage, width int, agentName string) []string {
	if message.Role == "divider" {
		label := " above is history "
		ruleWidth := max(0, width-len([]rune(label)))
		left := ruleWidth / 2
		right := ruleWidth - left
		line := strings.Repeat("─", left) + label + strings.Repeat("─", right)
		return []string{truncateRunesView(line, width)}
	}

	lines := aiSplitContent(message.Content)
	prefix := "USER: "
	contentWidth := max(1, width-len([]rune(prefix)))

	if message.Role == "user" {
		wrapped := aiWrapLines(lines, contentWidth)
		out := make([]string, 0, len(wrapped))
		for i, line := range wrapped {
			lead := prefix
			if i > 0 {
				lead = strings.Repeat(" ", len([]rune(prefix)))
			}
			out = append(out, padRightView(lead+line, width))
		}
		return out
	}

	suffix := " :" + agentName
	assistantWidth := max(1, width-len([]rune(suffix)))
	visible := aiWrapLines(lines, assistantWidth)
	out := make([]string, 0, len(visible)+1)
	for i, line := range visible {
		content := line
		if i == 0 {
			content += suffix
		}
		out = append(out, padLeftView(content, width))
	}
	return out
}

// BuildAiMessageLines renders all messages into role-tagged lines. Mirrors
// buildAiMessageLines.
func BuildAiMessageLines(messages []ChatMessage, width int, agentName string) []AiLine {
	if agentName == "" {
		agentName = "AI"
	}
	var out []AiLine
	for _, message := range messages {
		for _, line := range buildMessageLines(message, width, agentName) {
			out = append(out, AiLine{Role: message.Role, Content: line})
		}
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
		lines = append(lines, AiLine{Role: "assistant", Content: padLeftView(agentName+" is offline", width)})
	} else if pendingFrameIndex >= 0 {
		frame := aiPendingFrames[pendingFrameIndex%len(aiPendingFrames)]
		lines = append(lines, AiLine{Role: "assistant", Content: padLeftView(agentName+" is thinking"+frame, width)})
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
