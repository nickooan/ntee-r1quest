package view

import (
	"encoding/json"
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
