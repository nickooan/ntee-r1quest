package command

import (
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func TestParseCustomCommandInput(t *testing.T) {
	name, args, ok := ParseCustomCommandInput("/deploy staging fast")
	if !ok || name != "deploy" || len(args) != 2 || args[0] != "staging" || args[1] != "fast" {
		t.Fatalf("parse: name=%q args=%v ok=%v", name, args, ok)
	}
	if _, _, ok := ParseCustomCommandInput("not a command"); ok {
		t.Fatal("non-slash input should not parse")
	}
}

func TestExpandCustomCommandInstruction(t *testing.T) {
	got := ExpandCustomCommandInstruction("deploy $1 with $2 mode (extra $3)", []string{"staging", "fast"})
	if got != "deploy staging with fast mode (extra )" {
		t.Fatalf("expand: %q", got)
	}
}

func TestResolveCustomCommandPrompt(t *testing.T) {
	commands := []runtime.CustomCommand{
		{Name: "deploy", Instruction: "Deploy to $1 now"},
	}
	got, ok := ResolveCustomCommandPrompt(commands, "/deploy prod")
	if !ok || got != "Deploy to prod now" {
		t.Fatalf("resolve: %q ok=%v", got, ok)
	}
	if _, ok := ResolveCustomCommandPrompt(commands, "/unknown"); ok {
		t.Fatal("unknown command should not resolve")
	}
	if _, ok := ResolveCustomCommandPrompt(commands, "plain message"); ok {
		t.Fatal("plain message should not resolve")
	}
}

func TestMatchCustomCommands(t *testing.T) {
	commands := []runtime.CustomCommand{{Name: "deploy"}, {Name: "describe"}, {Name: "test"}}
	got := MatchCustomCommands(commands, "/de")
	if len(got) != 2 {
		t.Fatalf("expected 2 matches for /de, got %d", len(got))
	}
	// After a space the user has moved past the name; no suggestions.
	if MatchCustomCommands(commands, "/deploy x") != nil {
		t.Fatal("no matches once typing args")
	}
}
