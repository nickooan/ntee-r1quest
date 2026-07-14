package view

import (
	"encoding/json"
	"strings"
	"testing"
)

func agentChunk(text string) json.RawMessage {
	return json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"` + text + `"}}`)
}

func userChunk(text string) json.RawMessage {
	return json.RawMessage(`{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"` + text + `"}}`)
}

// textUserChunk builds a user_message_chunk with the text JSON-encoded, so it
// safely carries quotes and newlines (unlike userChunk's raw interpolation).
func textUserChunk(text string) json.RawMessage {
	encoded, _ := json.Marshal(text)
	return json.RawMessage(`{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":` + string(encoded) + `}}`)
}

func TestAppendACPResponseAccumulatesAssistant(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, agentChunk("Hel"))
	msgs = AppendACPResponse(msgs, agentChunk("lo"))
	if len(msgs) != 1 || msgs[0].Role != "assistant" || msgs[0].Content != "Hello" {
		t.Fatalf("expected one accumulated assistant message: %+v", msgs)
	}
}

func TestAppendACPResponseSeparatesDistinctResponses(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, agentChunk("ok, looking for it."))
	msgs = AppendACPResponse(msgs, agentChunk("response is here."))
	if len(msgs) != 1 {
		t.Fatalf("expected one assistant message: %+v", msgs)
	}
	if msgs[0].Content != "ok, looking for it.\nresponse is here." {
		t.Fatalf("distinct responses should be newline-separated: %q", msgs[0].Content)
	}
}

func TestAppendACPResponseMessageAfterToolStartsNewMessage(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"search"}`))
	msgs = AppendACPResponse(msgs, agentChunk("found it."))
	if len(msgs) != 2 || msgs[0].Role != "tool" || msgs[1].Role != "assistant" {
		t.Fatalf("expected tool message followed by assistant message: %+v", msgs)
	}
	if msgs[1].Content != "found it." {
		t.Fatalf("assistant content after tool call: %q", msgs[1].Content)
	}
}

func TestThinkingLineUsesAgentName(t *testing.T) {
	lines := BuildVisibleAiMessageLines(nil, 10, 40, 0, 0, false, "Codex")
	joined := ""
	for _, l := range lines {
		joined += l.Content
	}
	if !strings.Contains(joined, "Codex is thinking") {
		t.Fatalf("thinking line should use the agent name:\n%s", joined)
	}
}

func TestAppendACPResponseDedupesUserEcho(t *testing.T) {
	msgs := []ChatMessage{{Role: "user", Content: "hi"}}
	msgs = AppendACPResponse(msgs, userChunk("hi"))
	if len(msgs) != 1 {
		t.Fatalf("identical consecutive user echo should be ignored: %+v", msgs)
	}
}

func TestAppendACPResponseToolCall(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"read file","toolCallId":"t1","status":"pending"}`))
	if len(msgs) != 1 || msgs[0].Role != "tool" || msgs[0].Content != "read file" {
		t.Fatalf("tool call should append a tool message: %+v", msgs)
	}
	if msgs[0].ToolCallID != "t1" || msgs[0].ToolStatus != "pending" {
		t.Fatalf("tool call should keep id and status: %+v", msgs[0])
	}
}

func TestToolCallUpdateMergesInPlace(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"read file","toolCallId":"t1","status":"pending"}`))
	msgs = AppendACPResponse(msgs, agentChunk("working"))
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","title":"read file (done)"}`))
	if len(msgs) != 2 {
		t.Fatalf("update with matching id should not append: %+v", msgs)
	}
	if msgs[0].ToolStatus != "completed" || msgs[0].Content != "read file (done)" {
		t.Fatalf("update should mutate status and title in place: %+v", msgs[0])
	}
}

func TestToolCallUpdateWithoutMatchAppends(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"t9","status":"in_progress","title":"late tool"}`))
	if len(msgs) != 1 || msgs[0].Role != "tool" || msgs[0].Content != "late tool" {
		t.Fatalf("titled update without a match should append a tool message: %+v", msgs)
	}
	// A status-only update with no match and no title is dropped.
	msgs = AppendACPResponse(nil, json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"t9","status":"completed"}`))
	if len(msgs) != 0 {
		t.Fatalf("untitled update without a match should be ignored: %+v", msgs)
	}
}

const sampleTaskNotification = `<task-notification>
  <task-id>bp5xcx6zd</task-id>
  <tool-use-id>toolu_016Y2DNrYCTxYgsy8u48umyq</tool-use-id>
  <output-file>/private/tmp/claude/tasks/bp5xcx6zd.output</output-file>
  <status>killed</status>
  <summary>Background command "Sleep for 60 seconds in background" was stopped</summary>
</task-notification>`

func TestTaskNotificationRendersAsToolMessage(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, textUserChunk(sampleTaskNotification))
	if len(msgs) != 1 || msgs[0].Role != "tool" {
		t.Fatalf("task notification should become a single tool message: %+v", msgs)
	}
	m := msgs[0]
	if !strings.HasPrefix(m.Content, `Background command "Sleep for 60 seconds in background" was stopped`) {
		t.Fatalf("content should lead with the summary: %q", m.Content)
	}
	if !strings.Contains(m.Content, "output: /private/tmp/claude/tasks/bp5xcx6zd.output") {
		t.Fatalf("content should include the output file: %q", m.Content)
	}
	if m.ToolStatus != "failed" {
		t.Fatalf("killed status should map to failed (red bullet): %q", m.ToolStatus)
	}
	if m.ToolCallID != "toolu_016Y2DNrYCTxYgsy8u48umyq" {
		t.Fatalf("tool-use-id should key the message: %q", m.ToolCallID)
	}
}

func TestTaskNotificationCompletedStatus(t *testing.T) {
	blob := `<task-notification><status>completed</status><summary>done</summary></task-notification>`
	msgs := AppendACPResponse(nil, textUserChunk(blob))
	if len(msgs) != 1 || msgs[0].ToolStatus != "completed" || msgs[0].Content != "done" {
		t.Fatalf("completed notification should map to completed: %+v", msgs)
	}
}

func TestTaskNotificationMergesWithPriorToolCall(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"sleep 60","toolCallId":"toolu_016Y2DNrYCTxYgsy8u48umyq","status":"in_progress"}`))
	msgs = AppendACPResponse(msgs, textUserChunk(sampleTaskNotification))
	if len(msgs) != 1 {
		t.Fatalf("notification matching the tool-use-id should merge in place: %+v", msgs)
	}
	if msgs[0].ToolStatus != "failed" || !strings.Contains(msgs[0].Content, "was stopped") {
		t.Fatalf("merged tool line should adopt the notification status/summary: %+v", msgs[0])
	}
}

func TestTaskNotificationWithoutMatchAppends(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, agentChunk("working on it"))
	msgs = AppendACPResponse(msgs, textUserChunk(sampleTaskNotification))
	if len(msgs) != 2 || msgs[1].Role != "tool" {
		t.Fatalf("notification with no matching tool call should append a tool line: %+v", msgs)
	}
}

func TestNonNotificationUserTextStaysUser(t *testing.T) {
	msgs := AppendACPResponse(nil, textUserChunk("just a normal message"))
	if len(msgs) != 1 || msgs[0].Role != "user" || msgs[0].Content != "just a normal message" {
		t.Fatalf("ordinary user text should stay a user message: %+v", msgs)
	}
}

func TestTruncatedTaskNotificationStaysRaw(t *testing.T) {
	partial := "<task-notification>\n  <status>killed</status>"
	msgs := AppendACPResponse(nil, textUserChunk(partial))
	if len(msgs) != 1 || msgs[0].Role != "user" {
		t.Fatalf("a notification missing its closing tag should stay raw user text: %+v", msgs)
	}
}

func TestPermissionResolution(t *testing.T) {
	raw := json.RawMessage(`{"toolCall":{"title":"Run X"},"options":[{"optionId":"a1","kind":"allow_once"},{"optionId":"r1","kind":"reject_once"}]}`)
	p, ok := ParsePermission(raw)
	if !ok || p.Title != "Run X" || len(p.Options) != 2 {
		t.Fatalf("parse permission: %+v ok=%v", p, ok)
	}
	if FindPermissionOptionID(p, "allow") != "a1" {
		t.Fatal("allow should resolve to a1")
	}
	if FindPermissionOptionID(p, "reject") != "r1" {
		t.Fatal("reject should resolve to r1")
	}
}

func TestBuildAiMessageLines(t *testing.T) {
	lines := BuildAiMessageLines([]ChatMessage{{Role: "user", Content: "hi"}}, 40, "Claude")
	if len(lines) == 0 || lines[0].Role != "user" {
		t.Fatalf("expected a user line: %+v", lines)
	}
	if got := []rune(lines[0].Content); len(got) != 40 {
		t.Fatalf("user line should be padded to width 40, got %d", len(got))
	}
}

func TestToolLinesUseBulletAndStatusColor(t *testing.T) {
	lines := BuildAiMessageLines([]ChatMessage{
		{Role: "tool", Content: "read file", ToolStatus: "in_progress"},
		{Role: "tool", Content: "grep code", ToolStatus: "completed"},
		{Role: "tool", Content: "run tests", ToolStatus: "failed"},
	}, 40, "Claude")

	var toolLines []AiLine
	for _, l := range lines {
		if l.Role == "tool" {
			toolLines = append(toolLines, l)
		}
		if l.Role == "" {
			t.Fatalf("consecutive tool messages should not be separated by a gap: %+v", lines)
		}
	}
	if len(toolLines) != 3 {
		t.Fatalf("expected 3 tool lines: %+v", lines)
	}
	wantBullet := []string{"yellow", "green", "red"}
	for i, l := range toolLines {
		if len(l.Segments) < 2 || l.Segments[0].Text != "⏺ " || l.Segments[0].Color != wantBullet[i] {
			t.Fatalf("tool line %d bullet should be %s: %+v", i, wantBullet[i], l.Segments)
		}
		if l.Segments[1].Color != "gray" {
			t.Fatalf("tool title should be gray: %+v", l.Segments)
		}
	}
}

func TestAssistantLinesCarryMarkdownSegments(t *testing.T) {
	lines := BuildAiMessageLines([]ChatMessage{
		{Role: "assistant", Content: "see `foo` at https://example.com"},
	}, 60, "Claude")

	var assistant AiLine
	for _, l := range lines {
		if l.Role == "assistant" {
			assistant = l
		}
	}
	if assistant.Segments == nil {
		t.Fatalf("assistant line should carry segments: %+v", assistant)
	}
	sawCode, sawLink := false, false
	for _, s := range assistant.Segments {
		if s.Text == "`foo`" && s.Color == "yellow" {
			sawCode = true
		}
		if s.Text == "https://example.com" && s.Color == "cyan" && s.Underline {
			sawLink = true
		}
	}
	if !sawCode || !sawLink {
		t.Fatalf("expected code and link segments: %+v", assistant.Segments)
	}
	if got := []rune(assistant.Content); len(got) != 60 {
		t.Fatalf("assistant line should be padded to width 60, got %d", len(got))
	}
}

func TestAiMessagesAreLeftAlignedWithGap(t *testing.T) {
	lines := BuildAiMessageLines([]ChatMessage{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	}, 40, "Claude")

	sawGap := false
	assistantLine := ""
	for _, l := range lines {
		if l.Role == "" && strings.TrimSpace(l.Content) == "" {
			sawGap = true
		}
		if l.Role == "assistant" {
			assistantLine = l.Content
		}
	}
	if !sawGap {
		t.Fatalf("expected a blank gap line between turns: %+v", lines)
	}
	// Assistant is left-aligned with a name prefix (not right-aligned).
	if !strings.HasPrefix(assistantLine, "Claude: ") {
		t.Fatalf("assistant line should start with the agent prefix; got %q", assistantLine)
	}
}
