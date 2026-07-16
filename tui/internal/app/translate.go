package app

import (
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/command"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// translation is the result of running the typed AI input through the prompt
// pipeline on Enter-send. Display is the transcript text; Send is the prompt
// text sent to the agent; Refs are file references attached to that prompt as
// ACP resource_link blocks. The "[label]" reference pills stay literally in
// both Display and Send (readable, and never mis-parsed as a leading path) —
// the actual paths ride along in Refs.
type translation struct {
	Display string
	Send    string
	Refs    []runtime.AiPromptFileRef
}

type promptStage func(m *Model, t translation) translation

// aiPromptStages runs in order on Enter-send. Append future macro stages here.
// Order matters: custom commands expand first so reference pills passed as
// `/cmd [file]` arguments still resolve into Refs from the expanded text.
var aiPromptStages = []promptStage{
	expandCustomCommandStage, // `/name args` → configured instruction (Display + Send)
	attachRefPillsStage,      // "[label]" pills → Refs (resource_link attachments)
}

// translateAiInput turns the typed input into the transcript text and the
// prompt (plus file references) actually sent to the agent.
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

// attachRefPillsStage collects the file references whose "[label]" pill is
// still present in the sent text, so they travel as resource_link blocks. The
// pills stay in the text for readability.
func attachRefPillsStage(m *Model, t translation) translation {
	t.Refs = collectAiRefs(t.Send, m.aiRefs)
	return t
}
