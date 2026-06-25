package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

type fakeClient struct {
	result      runtime.ExecuteResult
	err         error
	recorded    []string
	endpoints   []runtime.ApiCallRecord
	aiStarted   []string
	aiPrompts   []string
	aiDecisions []string
}

func (f *fakeClient) Execute(_ context.Context, _ runtime.ExecuteRequest) (runtime.ExecuteResult, error) {
	return f.result, f.err
}

func (f *fakeClient) RecordInput(command string) error {
	f.recorded = append(f.recorded, command)
	return nil
}

func (f *fakeClient) ListApiEndpoints(_ context.Context) ([]runtime.ApiCallRecord, error) {
	return f.endpoints, nil
}

func (f *fakeClient) AiStart(_ context.Context, req runtime.AiStartRequest) error {
	f.aiStarted = append(f.aiStarted, req.Adaptor)
	return nil
}

func (f *fakeClient) AiPrompt(_ context.Context, text string) error {
	f.aiPrompts = append(f.aiPrompts, text)
	return nil
}

func (f *fakeClient) AiRespondPermission(_ context.Context, d runtime.AiPermissionDecision) error {
	f.aiDecisions = append(f.aiDecisions, d.OptionID)
	return nil
}

func (f *fakeClient) AiStop() error { return nil }

func apply(m Model, msg tea.Msg) (Model, tea.Cmd) {
	next, cmd := m.Update(msg)
	return next.(Model), cmd
}

func typeRunes(m Model, text string) Model {
	for _, r := range text {
		m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	return m
}

func TestTypingBuildsCommand(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "folder/get")

	if m.command != "folder/get" || m.cursor != 10 {
		t.Fatalf("command %q cursor %d", m.command, m.cursor)
	}

	// Backspace removes the last rune.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyBackspace})
	if m.command != "folder/ge" || m.cursor != 9 {
		t.Fatalf("after backspace: %q cursor %d", m.command, m.cursor)
	}
}

func TestEnterExecutesAndRendersResponse(t *testing.T) {
	fake := &fakeClient{result: runtime.ExecuteResult{Status: 200, StatusText: "OK"}}
	m := New(fake, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "folder/get")

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if !m.pending {
		t.Fatal("expected pending after Enter")
	}
	if cmd == nil {
		t.Fatal("expected an execute command")
	}
	if len(fake.recorded) != 1 || fake.recorded[0] != "folder/get" {
		t.Fatalf("recorded: %v", fake.recorded)
	}

	// Run the command and feed its message back.
	m, _ = apply(m, cmd())
	if m.pending {
		t.Fatal("expected pending cleared")
	}
	if m.response == nil || m.response.Status != 200 {
		t.Fatalf("response: %+v", m.response)
	}
}

func TestExecuteErrorShowsError(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, executeErrMsg{err: errString("boom")})
	if m.errText != "boom" || m.pending {
		t.Fatalf("errText %q pending %v", m.errText, m.pending)
	}
}

func TestSidebarRendersFileTree(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	out := m.View()
	if !strings.Contains(out, "orders") {
		t.Fatalf("sidebar should list the orders directory; view:\n%s", out)
	}
}

func TestViewCommandOpensFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "get.nts"), []byte("url example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.selectedCommand = "get"
	m.command = "@v"

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeView || m.openFile == nil {
		t.Fatalf("expected view mode with open file; mode=%d file=%v", m.mode, m.openFile)
	}
	if !strings.Contains(m.View(), "example.com") {
		t.Fatalf("view should show file content:\n%s", m.View())
	}
}

func TestEditInsertAndSave(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "get.nts")
	if err := os.WriteFile(path, []byte("url example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.selectedCommand = "get"
	m.command = "@e"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeEdit {
		t.Fatalf("expected edit mode, got %d", m.mode)
	}

	m = typeRunes(m, "X")
	if !m.edit.dirty {
		t.Fatal("editing should set dirty")
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlS})
	if m.edit.dirty {
		t.Fatal("save should clear dirty")
	}

	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(saved) != "Xurl example.com\n" {
		t.Fatalf("saved content: %q", string(saved))
	}
}

func TestTreeNavigationMovesSelection(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.nts"), []byte("url y\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.selectedCommand != "a" {
		t.Fatalf("first Down should select a, got %q", m.selectedCommand)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.selectedCommand != "b" {
		t.Fatalf("second Down should select b, got %q", m.selectedCommand)
	}
}

func TestHistoryCommandLoadsAndRenders(t *testing.T) {
	rec := runtime.ApiCallRecord{Endpoint: "/todos/1 [GET]", Method: "get"}
	rec.Response.Status = 200
	fake := &fakeClient{endpoints: []runtime.ApiCallRecord{rec}}

	m := New(fake, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "@h"

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("expected a history load command")
	}
	m, _ = apply(m, cmd())
	if m.mode != modeHistory || len(m.history) != 1 {
		t.Fatalf("expected history mode with 1 record; mode=%d n=%d", m.mode, len(m.history))
	}
	if !strings.Contains(m.View(), "/todos/1") {
		t.Fatalf("history view should show the endpoint:\n%s", m.View())
	}
}

func TestSearchFindsMatchesInResponse(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	res := runtime.ExecuteResult{Status: 200, StatusText: "OK"}
	m.response = &res
	m.command = "@search"

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeSearch {
		t.Fatalf("expected search mode, got %d", m.mode)
	}

	m = typeRunes(m, "200")
	matches := view.FindSearchMatches(m.searchContent, m.searchInput)
	if len(matches) == 0 {
		t.Fatalf("expected matches for '200' in:\n%s", m.searchContent)
	}

	// Esc returns to the previous mode.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeQuery {
		t.Fatalf("esc should return to query mode, got %d", m.mode)
	}
}

func TestAIModeStreamingFlow(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// @ai enters AI mode and starts the session.
	m.command = "@ai"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeAI {
		t.Fatalf("expected AI mode, got %d", m.mode)
	}
	if cmd != nil {
		cmd()
	}
	if len(fake.aiStarted) != 1 || fake.aiStarted[0] != "claude" {
		t.Fatalf("AiStart not dispatched: %v", fake.aiStarted)
	}
	m, _ = apply(m, AiStartedMsg{})
	if !m.aiActive {
		t.Fatal("session should be active after AiStartedMsg")
	}

	// Type and send a prompt.
	m = typeRunes(m, "hi")
	m, promptCmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if len(m.aiMessages) != 1 || m.aiMessages[0].Role != "user" || m.aiMessages[0].Content != "hi" {
		t.Fatalf("user message not appended: %+v", m.aiMessages)
	}
	if !m.aiThinking {
		t.Fatal("should be thinking after sending a prompt")
	}
	if promptCmd != nil {
		promptCmd()
	}
	if len(fake.aiPrompts) != 1 || fake.aiPrompts[0] != "hi" {
		t.Fatalf("AiPrompt not dispatched: %v", fake.aiPrompts)
	}

	// Stream an agent reply.
	m, _ = apply(m, AiUpdateMsg{Update: json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}`)})
	if m.aiThinking {
		t.Fatal("thinking should clear on reply")
	}
	last := m.aiMessages[len(m.aiMessages)-1]
	if last.Role != "assistant" || last.Content != "hello" {
		t.Fatalf("assistant message: %+v", last)
	}

	// A permission request, answered with 'y'.
	m, _ = apply(m, AiPermissionMsg{Raw: json.RawMessage(`{"toolCall":{"title":"Run X"},"options":[{"optionId":"a1","kind":"allow_once"},{"optionId":"r1","kind":"reject_once"}]}`)})
	if m.aiPermission == nil {
		t.Fatal("permission should be set")
	}
	m, respondCmd := apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if m.aiPermission != nil {
		t.Fatal("permission should clear after answering")
	}
	if respondCmd != nil {
		respondCmd()
	}
	if len(fake.aiDecisions) != 1 || fake.aiDecisions[0] != "a1" {
		t.Fatalf("allow decision not dispatched: %v", fake.aiDecisions)
	}
}

func TestEditModeSuggestionAccept(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "get.nts"), []byte("url example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.selectedCommand = "get"
	m.command = "@e"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeEdit {
		t.Fatalf("expected edit mode, got %d", m.mode)
	}

	// Type "re" → the "ref" keyword suggestion should appear.
	m = typeRunes(m, "re")
	if !m.editOverlayOpen() {
		t.Fatalf("expected a suggestion overlay; suggestions=%+v", m.editSuggestions)
	}

	// Tab accepts the selected suggestion, replacing the typed token.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyTab})
	if !strings.HasPrefix(m.edit.lines[0], "ref ") {
		t.Fatalf("expected line to start with 'ref ', got %q", m.edit.lines[0])
	}
}

func TestSearchAliasEntersSearchMode(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	res := runtime.ExecuteResult{Status: 200, StatusText: "OK"}
	m.response = &res

	m.command = "@s"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeSearch {
		t.Fatalf("@s should enter search mode, got %d", m.mode)
	}
}

func TestEditCommandWithPathArgument(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "@e folder/get"

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeEdit || m.openFile == nil || m.openFile.FileName != "get.nts" {
		t.Fatalf("@e <path> should open that file; mode=%d file=%v", m.mode, m.openFile)
	}
}

func TestQuickSwitchShiftTab(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyShiftTab})
	if cmd == nil {
		t.Fatal("shift+tab from query should load history")
	}
	m, _ = apply(m, cmd())
	if m.mode != modeHistory {
		t.Fatalf("shift+tab from query should reach history, got %d", m.mode)
	}
}

func TestEnterIgnoredWhenEmpty(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.pending || cmd != nil {
		t.Fatal("empty command should not execute")
	}
}
