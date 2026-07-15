package app

import "codeberg.org/nickoan/ntee-r1quest/tui/internal/command"

// translation is the result of running the typed AI input through the prompt
// pipeline on Enter-send. Display is what the transcript shows; Send is what
// goes to the agent — stages may diverge them (e.g. "[label]" reference pills
// stay readable in Display but expand to absolute paths in Send).
type translation struct {
	Display string
	Send    string
}

type promptStage func(m *Model, t translation) translation

// aiPromptStages runs in order on Enter-send. Append future macro stages here.
// Order matters: custom commands expand first so reference pills passed as
// `/cmd [file]` arguments still resolve in the final prompt.
var aiPromptStages = []promptStage{
	expandCustomCommandStage, // `/name args` → configured instruction (Display + Send)
	expandRefPillsStage,      // "[label]" → absolute path (Send only)
}

// translateAiInput turns the typed input into the transcript text and the
// prompt actually sent to the agent.
func (m *Model) translateAiInput(text string) translation {
	t := translation{Display: text, Send: text}
	for _, stage := range aiPromptStages {
		t = stage(m, t)
	}
	return t
}

// expandCustomCommandStage expands a `/name args` custom command into its
// configured instruction; the expanded text is both shown in the chat and
// sent to the agent (previous inline behavior, relocated here).
func expandCustomCommandStage(m *Model, t translation) translation {
	if resolved, ok := command.ResolveCustomCommandPrompt(m.config.CustomCommands, t.Send); ok {
		t.Display = resolved
		t.Send = resolved
	}
	return t
}

// expandRefPillsStage substitutes "[label]" reference pills with their
// absolute paths in the sent prompt only — the transcript keeps the pills.
func expandRefPillsStage(m *Model, t translation) translation {
	t.Send = expandAiRefs(t.Send, m.aiRefs)
	return t
}
