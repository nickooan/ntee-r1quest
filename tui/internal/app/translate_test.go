package app

import (
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func translateModel() Model {
	cfg := runtime.ConfigDTO{
		AIAdaptor: "claude",
		CustomCommands: []runtime.CustomCommand{
			{Name: "greet", Description: "say hi", Instruction: "say $1"},
		},
	}
	return New(&fakeClient{}, cfg)
}

func TestTranslateAiInputPassthrough(t *testing.T) {
	m := translateModel()
	got := m.translateAiInput("hello there")
	if got.Display != "hello there" || got.Send != "hello there" {
		t.Fatalf("plain text should pass through unchanged, got %+v", got)
	}
}

func TestTranslateAiInputCustomCommand(t *testing.T) {
	m := translateModel()
	got := m.translateAiInput("/greet bob")
	if got.Display != "say bob" || got.Send != "say bob" {
		t.Fatalf("custom command should expand in Display and Send, got %+v", got)
	}
}

func TestTranslateAiInputRefPill(t *testing.T) {
	m := translateModel()
	m.aiRefs = map[string]string{"f.nts": "/abs/f.nts"}
	got := m.translateAiInput("check [f.nts]")
	if got.Display != "check [f.nts]" {
		t.Fatalf("transcript should keep the pill, got %+v", got)
	}
	if got.Send != "check /abs/f.nts" {
		t.Fatalf("sent prompt should expand the pill, got %+v", got)
	}
}

func TestTranslateAiInputCommandThenPill(t *testing.T) {
	// Command expansion runs first, so a pill passed as a `/cmd` argument
	// still resolves in the final prompt.
	m := translateModel()
	m.aiRefs = map[string]string{"f.nts": "/abs/f.nts"}
	got := m.translateAiInput("/greet [f.nts]")
	if got.Display != "say [f.nts]" {
		t.Fatalf("transcript should show the expanded command with the pill, got %+v", got)
	}
	if got.Send != "say /abs/f.nts" {
		t.Fatalf("sent prompt should expand both stages, got %+v", got)
	}
}
