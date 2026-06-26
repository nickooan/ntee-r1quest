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

func TestAppendACPResponseMessageAfterToolNewLine(t *testing.T) {
	var msgs []ChatMessage
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"search"}`))
	msgs = AppendACPResponse(msgs, agentChunk("found it."))
	if msgs[0].Content != "\n[search]\nfound it." {
		t.Fatalf("a message after a tool call should start a new line: %q", msgs[0].Content)
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
	msgs = AppendACPResponse(msgs, json.RawMessage(`{"sessionUpdate":"tool_call","title":"read file"}`))
	if len(msgs) != 1 || msgs[0].Content != "\n[read file]" {
		t.Fatalf("tool call should append a bracketed note: %+v", msgs)
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
