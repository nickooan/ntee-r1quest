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
	// The pill stays literally in both Display and Send; the path rides in Refs.
	if got.Display != "check [f.nts]" || got.Send != "check [f.nts]" {
		t.Fatalf("pill should stay in the text, got %+v", got)
	}
	if len(got.Refs) != 1 || got.Refs[0].Path != "/abs/f.nts" || got.Refs[0].Name != "f.nts" {
		t.Fatalf("the file should be attached as a reference, got %+v", got.Refs)
	}
}

func TestTranslateAiInputCommandThenPill(t *testing.T) {
	// Command expansion runs first, so a pill passed as a `/cmd` argument
	// survives into the expanded instruction and is still attached as a ref.
	m := translateModel()
	m.aiRefs = map[string]string{"f.nts": "/abs/f.nts"}
	got := m.translateAiInput("/greet [f.nts]")
	if got.Display != "say [f.nts]" || got.Send != "say [f.nts]" {
		t.Fatalf("expanded command should keep the pill, got %+v", got)
	}
	if len(got.Refs) != 1 || got.Refs[0].Path != "/abs/f.nts" {
		t.Fatalf("the pill in the expanded command should attach a ref, got %+v", got.Refs)
	}
}
