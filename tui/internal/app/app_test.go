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
	result         runtime.ExecuteResult
	err            error
	recorded       []string
	endpoints      []runtime.ApiCallRecord
	traceCalls     []runtime.ApiCallRecord
	traceRequested string
	aiSessions     []runtime.AiSessionRecord
	aiStarted      []string
	aiResumed      []string
	aiPrompts      []string
	aiDecisions    []string
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

func (f *fakeClient) ListTraceCalls(_ context.Context, traceID string) ([]runtime.ApiCallRecord, error) {
	f.traceRequested = traceID
	return f.traceCalls, nil
}

func (f *fakeClient) ListAiSessions(_ context.Context, _ string) ([]runtime.AiSessionRecord, error) {
	return f.aiSessions, nil
}

func (f *fakeClient) AiStart(_ context.Context, req runtime.AiStartRequest) error {
	f.aiStarted = append(f.aiStarted, req.Adaptor)
	f.aiResumed = append(f.aiResumed, req.ResumeSessionID)
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
	// Enter executes only a matched REQUEST entry, so the request must exist.
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeClient{result: runtime.ExecuteResult{Status: 200, StatusText: "OK"}}
	m := New(fake, runtime.ConfigDTO{Root: root})
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

func TestShiftArrowMovesSidebarSelection(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.nts"), []byte("url y\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// Shift+Down moves the HIGHLIGHT (keyboardSelectedCommand), not selectedCommand.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.keyboardSelectedCommand != "a" {
		t.Fatalf("first shift+down should highlight a, got %q", m.keyboardSelectedCommand)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.keyboardSelectedCommand != "b" {
		t.Fatalf("second shift+down should highlight b, got %q", m.keyboardSelectedCommand)
	}
	// Plain Down must NOT move the sidebar selection (it scrolls the result).
	before := m.keyboardSelectedCommand
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.keyboardSelectedCommand != before {
		t.Fatalf("plain Down should not change the sidebar highlight")
	}
}

func TestShiftArrowReflectsIntoInputAndPopup(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "list.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// Type a prefix so the popup opens, then enter the dir so it has children.
	m.command = "orders/"
	m.selectedCommand = "orders/"

	// Popup now lists orders/get and orders/list; shift+down navigates it and
	// reflects the selection into the input bar + sidebar highlight + popup index.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.commandPreview == "" {
		t.Fatal("shift+down should reflect the selection into the input bar")
	}
	if m.keyboardSelectedCommand != m.commandPreview {
		t.Fatalf("sidebar highlight (%q) should match the input preview (%q)", m.keyboardSelectedCommand, m.commandPreview)
	}

	// Typing clears the preview and returns to the editable typed command.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})
	if m.commandPreview != "" {
		t.Fatal("typing should clear the navigation preview")
	}
}

func TestShiftNavOntoDirectoryDoesNotExpand(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown}) // highlight "orders/"
	if m.keyboardSelectedCommand != "orders/" {
		t.Fatalf("expected orders/ highlighted, got %q", m.keyboardSelectedCommand)
	}
	// The tree must NOT have expanded (selectedCommand unchanged → no orders/get).
	for _, e := range m.treeEntries() {
		if e.CommandValue == "orders/get" {
			t.Fatal("directory should not auto-expand on highlight")
		}
	}
}

func TestEnterOnDirectoryEntersNotExecute(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.keyboardSelectedCommand = "orders/"

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil || m.pending || len(fake.recorded) != 0 {
		t.Fatalf("Enter on a directory must not execute; recorded=%v pending=%v", fake.recorded, m.pending)
	}
	if m.selectedCommand != "orders/" || m.command != "orders/" {
		t.Fatalf("Enter on a directory should enter it; selected=%q command=%q", m.selectedCommand, m.command)
	}
	// Now expanded → orders/get is visible.
	found := false
	for _, e := range m.treeEntries() {
		if e.CommandValue == "orders/get" {
			found = true
		}
	}
	if !found {
		t.Fatal("entering a directory should expand it")
	}
}

func TestEnterOnNonMatchingPathIsNoop(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "nope/missing")

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil || m.pending || len(fake.recorded) != 0 {
		t.Fatalf("Enter on a non-matching path must be a no-op; recorded=%v", fake.recorded)
	}
}

func TestEscMovesToParentDirectory(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "orders/sub/"
	m.selectedCommand = "orders/sub/"

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.command != "orders/" || m.selectedCommand != "orders/" || m.keyboardSelectedCommand != "" {
		t.Fatalf("Esc should go to parent dir; command=%q selected=%q", m.command, m.selectedCommand)
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

func TestHistoryTraceFilter(t *testing.T) {
	c1 := runtime.ApiCallRecord{Endpoint: "/a [GET]", Method: "get", TraceID: "trace-9"}
	c2 := runtime.ApiCallRecord{Endpoint: "/b [GET]", Method: "get", TraceID: "trace-9"}
	fake := &fakeClient{
		endpoints:  []runtime.ApiCallRecord{{Endpoint: "/all [GET]"}},
		traceCalls: []runtime.ApiCallRecord{c1, c2},
	}

	m := New(fake, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "@h trace-9"

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("expected a history load command")
	}
	m, _ = apply(m, cmd())

	if fake.traceRequested != "trace-9" {
		t.Fatalf("@h <traceId> should call ListTraceCalls with the id; got %q", fake.traceRequested)
	}
	if m.historyTraceFilter != "trace-9" || len(m.history) != 2 {
		t.Fatalf("history should be the trace's 2 calls; filter=%q n=%d", m.historyTraceFilter, len(m.history))
	}
	// The filtered sidebar numbers calls in order.
	view := m.View()
	if !strings.Contains(view, "1. /a [GET]") || !strings.Contains(view, "2. /b [GET]") {
		t.Fatalf("trace view should number calls in order:\n%s", view)
	}
}

func TestHistoryShiftSelectsAndScrollSeparated(t *testing.T) {
	recA := runtime.ApiCallRecord{Endpoint: "/a [GET]", Method: "get"}
	recA.Response.Status = 200
	recB := runtime.ApiCallRecord{Endpoint: "/b [GET]", Method: "get"}
	recB.Response.Status = 201
	fake := &fakeClient{endpoints: []runtime.ApiCallRecord{recA, recB}}

	m := New(fake, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "@h"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	m, _ = apply(m, cmd())
	if m.mode != modeHistory {
		t.Fatalf("expected history mode, got %d", m.mode)
	}

	// Shift+Down selects the next record (left list).
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.historyIndex != 1 {
		t.Fatalf("shift+down should select next record, got %d", m.historyIndex)
	}

	// Plain Up/Down scroll the right pane only — never the selection.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyUp})
	if m.historyIndex != 1 {
		t.Fatalf("plain up/down must not change selection, got %d", m.historyIndex)
	}

	// `q` no longer exits; Esc does. `s` enters search.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("q")})
	if m.mode != modeHistory {
		t.Fatalf("q must not exit history; mode=%d", m.mode)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("s")})
	if m.mode != modeSearch {
		t.Fatalf("s should enter search from history, got %d", m.mode)
	}

	// The sidebar must keep showing the history list (not the file tree) while
	// searching over @history. Record "/a" is the unselected entry, so it only
	// appears in the history sidebar.
	if !strings.Contains(m.View(), "/a") {
		t.Fatalf("search-over-history should keep the history sidebar:\n%s", m.View())
	}
}

func TestCopyShowsNoticeInQueryMode(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	m, _ = apply(m, copiedMsg{})
	if m.notice != "copied" {
		t.Fatalf("successful copy should set notice; got %q", m.notice)
	}
	if !strings.Contains(m.View(), "copied") {
		t.Fatalf("query status line should show the copied notice:\n%s", m.View())
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

func TestAiSessionPickerResumesNewestSession(t *testing.T) {
	fake := &fakeClient{aiSessions: []runtime.AiSessionRecord{
		{ID: "sess-old", UpdatedAt: "2026-01-01T10:00:00Z"},
		{ID: "sess-new", UpdatedAt: "2026-02-02T12:30:00Z"},
	}}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	m.command = "@ai"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	m, _ = apply(m, cmd()) // resolve the session list → show picker
	if !m.aiPicking {
		t.Fatal("picker should appear when past sessions exist")
	}
	if len(fake.aiStarted) != 0 {
		t.Fatalf("nothing should start before the user confirms: %v", fake.aiStarted)
	}
	if !strings.Contains(m.View(), "New session") || !strings.Contains(m.View(), "sess-new") {
		t.Fatalf("picker should list New session + past sessions:\n%s", m.View())
	}

	// Newest-first display: row 1 is sess-new. Select it and confirm.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	m, startCmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.aiPicking {
		t.Fatal("confirming should dismiss the picker")
	}
	if startCmd != nil {
		startCmd()
	}
	if len(fake.aiResumed) != 1 || fake.aiResumed[0] != "sess-new" {
		t.Fatalf("expected resume of newest session; got %v", fake.aiResumed)
	}
}

func TestAiSessionPickerNewAndCancel(t *testing.T) {
	sessions := []runtime.AiSessionRecord{{ID: "sess-1", UpdatedAt: "2026-01-01T10:00:00Z"}}

	// Row 0 ("New session") starts a fresh session (empty resume id).
	fake := &fakeClient{aiSessions: sessions}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "@ai"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	m, _ = apply(m, cmd())
	m, startCmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter}) // index 0 = New session
	if startCmd != nil {
		startCmd()
	}
	if len(fake.aiResumed) != 1 || fake.aiResumed[0] != "" {
		t.Fatalf("New session should start with no resume id; got %v", fake.aiResumed)
	}

	// Esc cancels the picker back to query mode without starting anything.
	fake2 := &fakeClient{aiSessions: sessions}
	m2 := New(fake2, runtime.ConfigDTO{AIAdaptor: "claude"})
	m2, _ = apply(m2, tea.WindowSizeMsg{Width: 80, Height: 24})
	m2.command = "@ai"
	m2, cmd2 := apply(m2, tea.KeyMsg{Type: tea.KeyEnter})
	m2, _ = apply(m2, cmd2())
	m2, _ = apply(m2, tea.KeyMsg{Type: tea.KeyEsc})
	if m2.aiPicking || m2.mode != modeQuery {
		t.Fatalf("esc should cancel the picker to query mode; picking=%v mode=%d", m2.aiPicking, m2.mode)
	}
	if len(fake2.aiStarted) != 0 {
		t.Fatalf("cancel should not start a session: %v", fake2.aiStarted)
	}
}

func TestResumedSessionAddsHistoryDivider(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI

	// Replayed history arrives as session updates before the started event.
	m, _ = apply(m, AiUpdateMsg{Update: json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"old reply"}}`)})
	m, _ = apply(m, AiStartedMsg{Resumed: true})
	if last := m.aiMessages[len(m.aiMessages)-1]; last.Role != "divider" {
		t.Fatalf("resumed start should append a history divider; got %+v", m.aiMessages)
	}

	// A fresh (non-resumed) start adds no divider.
	m2 := New(&fakeClient{}, runtime.ConfigDTO{AIAdaptor: "claude"})
	m2, _ = apply(m2, tea.WindowSizeMsg{Width: 80, Height: 24})
	m2, _ = apply(m2, AiStartedMsg{})
	for _, msg := range m2.aiMessages {
		if msg.Role == "divider" {
			t.Fatal("fresh start should not add a divider")
		}
	}
}

func TestAiInputMultilineEditing(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI

	// Ctrl+J inserts a newline instead of submitting.
	m = typeRunes(m, "abcde")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyCtrlJ})
	m = typeRunes(m, "fg")
	if m.aiInput != "abcde\nfg" {
		t.Fatalf("ctrl+j should insert a newline; got %q", m.aiInput)
	}
	if len(m.aiMessages) != 0 {
		t.Fatal("ctrl+j must not submit")
	}

	// Shift+Down from the long line clamps the cursor to the shorter line's end.
	m.aiInputCursor = 5
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.aiInputCursor != 8 {
		t.Fatalf("shift+down should clamp to the shorter line end (8); got %d", m.aiInputCursor)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyUp, Alt: true})
	if m.aiInputCursor != 2 {
		t.Fatalf("opt+up should preserve column 2; got %d", m.aiInputCursor)
	}

	// Plain Enter submits the whole multi-line text.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if len(m.aiMessages) != 1 || m.aiMessages[0].Content != "abcde\nfg" {
		t.Fatalf("enter should submit the multi-line input; got %+v", m.aiMessages)
	}
}

func TestAIModeStreamingFlow(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// @ai enters AI mode. With no past sessions the picker is skipped and a fresh
	// session starts (after the async session-list resolves).
	m.command = "@ai"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeAI {
		t.Fatalf("expected AI mode, got %d", m.mode)
	}
	if cmd == nil {
		t.Fatal("expected a session-list command")
	}
	m, startCmd := apply(m, cmd()) // aiSessionsLoadedMsg → aiStartCmd
	if m.aiPicking {
		t.Fatal("no picker should appear without past sessions")
	}
	if startCmd != nil {
		startCmd()
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

func TestEditEscDiscardsToView(t *testing.T) {
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

	m = typeRunes(m, "zzz") // unsaved change (no suggestion match, so no popup)
	if m.editOverlayOpen() {
		t.Fatal("did not expect a suggestion popup for 'zzz'")
	}

	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeView {
		t.Fatalf("esc from edit should return to view, got mode %d", m.mode)
	}
	if m.openFile == nil || m.openFile.Content != "url example.com\n" {
		t.Fatalf("discarded edit should leave the original file content; got %v", m.openFile)
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
