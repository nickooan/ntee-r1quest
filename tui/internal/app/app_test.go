package app

import (
	"context"
	"encoding/json"
	"fmt"
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
	reloaded       bool
	reloadConfig   runtime.ConfigDTO
	cacheCleared   bool
	aiStopped      bool
	cachedInputs   []string
	recorded       []string
	endpoints      []runtime.ApiCallRecord
	traceCalls     []runtime.ApiCallRecord
	traceRequested string
	aiSessions     []runtime.AiSessionRecord
	aiStarted      []string
	aiResumed      []string
	aiPrompts      []string
	aiPromptRefs   [][]runtime.AiPromptFileRef
	aiDecisions    []string
	snapshots      map[int64]runtime.SnapshotRecord
	snapshotPuts   []int64
	snapshotDels   []int64
}

func (f *fakeClient) SnapshotPut(path string, seq int64, kind, content string) error {
	if f.snapshots == nil {
		f.snapshots = map[int64]runtime.SnapshotRecord{}
	}
	f.snapshots[seq] = runtime.SnapshotRecord{Path: path, Seq: seq, Kind: kind, Content: content}
	f.snapshotPuts = append(f.snapshotPuts, seq)
	return nil
}

func (f *fakeClient) SnapshotGet(_ context.Context, seq int64) (runtime.SnapshotRecord, bool, error) {
	rec, ok := f.snapshots[seq]
	return rec, ok, nil
}

func (f *fakeClient) SnapshotList(_ context.Context, _ string, _ int) ([]runtime.SnapshotMeta, error) {
	return nil, nil
}

func (f *fakeClient) SnapshotDelete(seqs []int64) error {
	for _, seq := range seqs {
		delete(f.snapshots, seq)
		f.snapshotDels = append(f.snapshotDels, seq)
	}
	return nil
}

func (f *fakeClient) Execute(_ context.Context, _ runtime.ExecuteRequest) (runtime.ExecuteResult, error) {
	return f.result, f.err
}

func (f *fakeClient) Reload(_ context.Context) (runtime.ConfigDTO, error) {
	f.reloaded = true
	return f.reloadConfig, nil
}

func (f *fakeClient) ClearCache(_ context.Context) error {
	f.cacheCleared = true
	return nil
}

func (f *fakeClient) RecordInput(command string) error {
	f.recorded = append(f.recorded, command)
	return nil
}

func (f *fakeClient) SuggestInputs(_ context.Context, _ string, _ int) ([]string, error) {
	return f.cachedInputs, nil
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

func (f *fakeClient) AiPrompt(_ context.Context, text string, refs []runtime.AiPromptFileRef) error {
	f.aiPrompts = append(f.aiPrompts, text)
	f.aiPromptRefs = append(f.aiPromptRefs, refs)
	return nil
}

func (f *fakeClient) AiRespondPermission(_ context.Context, d runtime.AiPermissionDecision) error {
	f.aiDecisions = append(f.aiDecisions, d.OptionID)
	return nil
}

func (f *fakeClient) AiStop() error {
	f.aiStopped = true
	return nil
}

func apply(m Model, msg tea.Msg) (Model, tea.Cmd) {
	next, cmd := m.Update(msg)
	return next.(Model), cmd
}

// drain runs a command to completion, unwrapping tea.Batch so nested commands
// (e.g. the prompt dispatch batched with the thinking-animation ticker) each
// actually execute against the fake client.
func drain(cmd tea.Cmd) {
	if cmd == nil {
		return
	}
	switch msg := cmd().(type) {
	case tea.BatchMsg:
		for _, c := range msg {
			drain(c)
		}
	}
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

func TestNonExecutableFileViewConfirm(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "readme.txt"), []byte("hello world\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "readme.txt")

	// Enter on a non-.nts file asks whether to view it (no execute, stays in query).
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.pendingViewFile != "readme.txt" || m.mode != modeQuery {
		t.Fatalf("should show the view confirm; pending=%q mode=%d", m.pendingViewFile, m.mode)
	}
	if !strings.Contains(m.View(), "not a r1q executable") {
		t.Fatalf("overlay should explain the file is not executable:\n%s", m.View())
	}

	// Enter confirms → view mode with the file content.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeView || m.openFile == nil || m.openFile.FileName != "readme.txt" {
		t.Fatalf("confirm should open view mode; mode=%d file=%v", m.mode, m.openFile)
	}
	if !strings.Contains(m.View(), "hello world") {
		t.Fatalf("view should show the file content:\n%s", m.View())
	}
}

func TestNonExecutableFileViewCancelKeepsSelection(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "readme.txt"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "readme.txt")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})

	// 'n' cancels: input cleared, file stays selected, still in query.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("n")})
	if m.pendingViewFile != "" || m.command != "" || m.mode != modeQuery {
		t.Fatalf("cancel should clear the confirm + input; pending=%q cmd=%q mode=%d", m.pendingViewFile, m.command, m.mode)
	}
	if m.keyboardSelectedCommand != "readme.txt" {
		t.Fatalf("cancel should keep the file selected; got %q", m.keyboardSelectedCommand)
	}
}

func TestBinaryFileShowsNotReadableOverlay(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "bin.dat"), []byte{0x00, 0x01, 'x'}, 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "bin.dat")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter}) // non-.nts → confirm
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter}) // yes → open → binary

	if m.messageOverlay == "" || m.mode != modeQuery {
		t.Fatalf("binary file should show a not-readable overlay; overlay=%q mode=%d", m.messageOverlay, m.mode)
	}
	if !strings.Contains(m.View(), "not a readable file") {
		t.Fatalf("overlay should say the file is not readable:\n%s", m.View())
	}

	// Enter dismisses; selection stays on the file.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.messageOverlay != "" {
		t.Fatal("enter should dismiss the overlay")
	}
	if m.keyboardSelectedCommand != "bin.dat" {
		t.Fatalf("selection should stay on the file; got %q", m.keyboardSelectedCommand)
	}
}

func TestTypingAfterPreviewContinuesFromSelection(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "orders/"
	m.selectedCommand = "orders/"

	// Navigate the popup → a preview is shown in the input bar.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	preview := m.commandPreview
	if preview == "" {
		t.Fatal("expected a navigation preview")
	}

	// Typing adopts the preview and continues from it (cursor at end).
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("X")})
	if m.commandPreview != "" {
		t.Fatal("typing should clear the preview")
	}
	if m.command != preview+"X" {
		t.Fatalf("typing should continue from the selection; got %q want %q", m.command, preview+"X")
	}
}

func TestOpenSuffixViewAndEdit(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "readme.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// `<file> @v` opens view mode for a plain file.
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "readme.txt @v"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeView || m.openFile == nil || m.openFile.FileName != "readme.txt" {
		t.Fatalf("`<file> @v` should open view mode; mode=%d file=%v", m.mode, m.openFile)
	}

	// `<file> @e` opens edit mode (works for a .nts request file too).
	m2 := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m2, _ = apply(m2, tea.WindowSizeMsg{Width: 80, Height: 24})
	m2.command = "get @e"
	m2, _ = apply(m2, tea.KeyMsg{Type: tea.KeyEnter})
	if m2.mode != modeEdit || m2.openFile == nil || m2.openFile.FileName != "get.nts" {
		t.Fatalf("`<file> @e` should open edit mode; mode=%d file=%v", m2.mode, m2.openFile)
	}
}

func TestOpenSuffixBinaryShowsOverlay(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "bin.dat"), []byte{0x00, 'x'}, 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.command = "bin.dat @v"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})

	if m.mode != modeQuery || m.messageOverlay == "" {
		t.Fatalf("`<binary> @v` should show the not-readable overlay and stay in query; mode=%d overlay=%q", m.mode, m.messageOverlay)
	}
}

func TestExternalEventHighlightsRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m = typeRunes(m, "stale input") // should be cleared by the event

	m, _ = apply(m, ExternalEventMsg{Event: runtime.ExternalRequestEvent{
		NtsPath:         "orders",
		NtsFile:         "get.nts",
		ResponseContent: "200 OK",
	}})

	if m.selectedCommand != "orders/get" {
		t.Fatalf("external event should select the request; got %q", m.selectedCommand)
	}
	if m.command != "" {
		t.Fatalf("external event should clear the typed command; got %q", m.command)
	}
	if m.highlightedSidebarCommand() != "orders/get" {
		t.Fatalf("the request should be highlighted; got %q", m.highlightedSidebarCommand())
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

func TestHistoryHorizontalScroll(t *testing.T) {
	// A wide URL line makes the record scroll horizontally in the right pane.
	recA := runtime.ApiCallRecord{Endpoint: "/wide [GET]", Method: "get"}
	recA.Request.URL = "https://example.com/" + strings.Repeat("x", 200)
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
	if m.historyMaxScrollX() <= 0 {
		t.Fatalf("wide content should allow horizontal scroll, max=%d", m.historyMaxScrollX())
	}

	// Right scrolls right; Left scrolls back; Left clamps at 0.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRight})
	if m.historyScrollX != 1 {
		t.Fatalf("KeyRight should scroll right, got %d", m.historyScrollX)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRight})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyLeft})
	if m.historyScrollX != 1 {
		t.Fatalf("KeyLeft should scroll back to 1, got %d", m.historyScrollX)
	}
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyLeft})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyLeft})
	if m.historyScrollX != 0 {
		t.Fatalf("KeyLeft should clamp at 0, got %d", m.historyScrollX)
	}

	// Selecting a different record resets horizontal scroll.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRight})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyShiftDown})
	if m.historyIndex != 1 || m.historyScrollX != 0 {
		t.Fatalf("shift+down should select next and reset scrollX; index=%d scrollX=%d", m.historyIndex, m.historyScrollX)
	}
}

func TestReloadAndClearCacheCommands(t *testing.T) {
	fake := &fakeClient{
		reloadConfig: runtime.ConfigDTO{Root: "/new/root", Version: "9.9.9"},
		endpoints:    []runtime.ApiCallRecord{{Endpoint: "/a [GET]"}},
	}
	m := New(fake, runtime.ConfigDTO{Root: "/old"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// Dirty front-end state that a reload should reset.
	res := runtime.ExecuteResult{Status: 200}
	m.response = &res
	m.selectedCommand = "stale/path"
	m.aiActive = true
	m.aiMessages = []view.ChatMessage{{Role: "user", Content: "hi"}}

	// @reload re-resolves config, adopts the returned DTO, and resets the view.
	m.command = "@reload"
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("expected a reload command")
	}
	m, stopCmd := apply(m, cmd())
	if stopCmd != nil {
		stopCmd() // runs AiStop for the previously-active session
	}
	if !fake.reloaded || m.config.Root != "/new/root" || m.notice != "reloaded" {
		t.Fatalf("@reload should adopt the new config; reloaded=%v root=%q notice=%q", fake.reloaded, m.config.Root, m.notice)
	}
	if m.mode != modeQuery || m.response != nil || m.selectedCommand != "" {
		t.Fatalf("@reload should reset the view; mode=%d response=%v selected=%q", m.mode, m.response, m.selectedCommand)
	}
	if m.aiActive || len(m.aiMessages) != 0 || !fake.aiStopped {
		t.Fatalf("@reload should clear the AI chat and stop the session; active=%v msgs=%d stopped=%v", m.aiActive, len(m.aiMessages), fake.aiStopped)
	}

	// @cc clears the cache and the loaded history.
	m.history = fake.endpoints
	m.command = "@cc"
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	m, _ = apply(m, cmd())
	if !fake.cacheCleared || len(m.history) != 0 || m.notice != "cache cleared" {
		t.Fatalf("@cc should clear cache + history; cleared=%v n=%d notice=%q", fake.cacheCleared, len(m.history), m.notice)
	}
}

func TestQueryFuzzyFindsRequestsInCollapsedDirectories(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get-orders-by-id.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeClient{result: runtime.ExecuteResult{Status: 200, StatusText: "OK"}}
	m := New(fake, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// "by-id" is neither a prefix of anything nor inside an expanded directory —
	// the popup must still offer the nested request by substring, full path shown.
	for _, r := range "by-id" {
		m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if !strings.Contains(m.View(), "orders/get-orders-by-id") {
		t.Fatalf("fuzzy suggestion should appear in the popup:\n%s", m.View())
	}

	// Enter executes the suggested request directly.
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if !m.pending {
		t.Fatal("selecting the fuzzy suggestion should execute it")
	}
	if cmd != nil {
		m, _ = apply(m, cmd())
	}
	if len(fake.recorded) == 0 || fake.recorded[len(fake.recorded)-1] != "orders/get-orders-by-id" {
		t.Fatalf("should execute orders/get-orders-by-id; recorded=%v", fake.recorded)
	}
	if m.selectedCommand != "orders/get-orders-by-id" {
		t.Fatalf("the request should be selected on the left; got %q", m.selectedCommand)
	}
}

func TestQueryMergesCachedInputs(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "orders.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeClient{cachedInputs: []string{"orders/get-old"}}
	m := New(fake, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	// Each keystroke dispatches the cached-input fetch; run the returned command.
	for _, r := range "or" {
		var cmd tea.Cmd
		m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			m, _ = apply(m, cmd())
		}
	}

	if m.cachedInputsPrefix != "or" {
		t.Fatalf("cached inputs should be fetched for the current command; prefix=%q", m.cachedInputsPrefix)
	}
	if !strings.Contains(m.View(), "orders/get-old") {
		t.Fatalf("a cached input should appear in the suggestion popup:\n%s", m.View())
	}
}

func TestSelectingCachedInputResolvesAndExecutes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders", "get.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A cached input identical to an existing request path is deduped away (the
	// file suggestion covers it), so use a partial typed input: it survives as a
	// cache row and must still resolve to orders/get via prefix matching.
	fake := &fakeClient{
		result:       runtime.ExecuteResult{Status: 200, StatusText: "OK"},
		cachedInputs: []string{"orders/ge"},
	}
	m := New(fake, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})

	for _, r := range "or" {
		var cmd tea.Cmd
		m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			m, _ = apply(m, cmd())
		}
	}

	// Locate the green cached suggestion and select it.
	sugs := m.queryInputSuggestions(m.treeEntries())
	idx := -1
	for i, s := range sugs {
		if s.Source == "cache" && s.InsertText == "orders/ge" {
			idx = i
		}
	}
	if idx < 0 {
		t.Fatalf("expected a cached suggestion for orders/ge; got %+v", sugs)
	}
	m.inputSuggestIndex = idx

	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if !m.pending {
		t.Fatal("selecting a cached request input should execute it")
	}
	if m.selectedCommand != "orders/get" {
		t.Fatalf("the request should be highlighted on the left; got %q", m.selectedCommand)
	}
	if m.command != "" {
		t.Fatalf("input should clear on execute; got %q", m.command)
	}
	if cmd != nil {
		m, _ = apply(m, cmd())
	}
	if len(fake.recorded) == 0 || fake.recorded[len(fake.recorded)-1] != "orders/get" {
		t.Fatalf("should execute orders/get; recorded=%v", fake.recorded)
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

func TestComputeThinking(t *testing.T) {
	m := Model{}
	if m.computeThinking() {
		t.Fatal("no pending turn → idle")
	}
	// The indicator is on for the whole turn, regardless of streaming gaps or
	// tool activity — it turns off only when the turn is no longer pending.
	m.aiPending = true
	if !m.computeThinking() {
		t.Fatal("pending turn → thinking")
	}
	m.aiPending = false
	if m.computeThinking() {
		t.Fatal("turn done → idle")
	}
}

func TestAiTurnDoneClearsThinking(t *testing.T) {
	m := Model{aiPending: true, aiThinking: true, aiTicking: true, aiTurnID: 3}

	// A stale completion from an earlier turn is ignored.
	m2, _ := apply(m, AiTurnDoneMsg{ID: 2})
	if !m2.aiPending || !m2.aiThinking {
		t.Fatalf("stale turn-done must not clear the active turn; %+v", m2)
	}

	// The current turn's completion turns the indicator off.
	m3, _ := apply(m, AiTurnDoneMsg{ID: 3})
	if m3.aiPending || m3.aiThinking || m3.aiTicking {
		t.Fatalf("turn-done should clear thinking state; %+v", m3)
	}
}

func TestTrackToolStatus(t *testing.T) {
	m := Model{}
	m.trackToolStatus(json.RawMessage(`{"sessionUpdate":"tool_call","toolCallId":"t1","status":"pending"}`))
	if !m.aiTools["t1"] {
		t.Fatal("tool_call should mark the tool in progress")
	}
	m.trackToolStatus(json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed"}`))
	if m.aiTools["t1"] {
		t.Fatal("completed tool_call_update should clear it")
	}
}

func TestAIModeCapturesAppCommands(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true

	// Typing an @-command in AI mode runs the TUI action, not an AI prompt.
	m = typeRunes(m, "@query")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeQuery {
		t.Fatalf("@query in AI mode should switch to query mode, got %d", m.mode)
	}
	if len(fake.aiPrompts) != 0 {
		t.Fatalf("an @-command must not be sent to the agent: %v", fake.aiPrompts)
	}

	// A normal message is still sent to the agent.
	m.mode = modeAI
	m = typeRunes(m, "what is @env?")
	m, promptCmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(promptCmd)
	if len(fake.aiPrompts) != 1 || fake.aiPrompts[0] != "what is @env?" {
		t.Fatalf("a normal message should reach the agent: %v", fake.aiPrompts)
	}
}

func TestAISlashCommandSuggestionPopup(t *testing.T) {
	cfg := runtime.ConfigDTO{
		AIAdaptor: "claude",
		CustomCommands: []runtime.CustomCommand{
			{Name: "for-test", Description: "use for testing", Instruction: "do $1"},
			{Name: "format", Description: "format it", Instruction: "fmt"},
		},
	}
	fake := &fakeClient{}
	m := New(fake, cfg)
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true

	// Typing `/fo` shows both matching commands in the popup.
	m = typeRunes(m, "/fo")
	if !strings.Contains(m.View(), "for-test") || !strings.Contains(m.View(), "format") {
		t.Fatalf("`/fo` should list matching custom commands:\n%s", m.View())
	}

	// Down selects the second; Tab accepts it (inserts `/name `), nothing is sent.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyTab})
	if m.aiInput != "/format " {
		t.Fatalf("Tab should accept the highlighted command; got %q", m.aiInput)
	}
	if len(fake.aiPrompts) != 0 {
		t.Fatalf("accepting a command must not send a prompt: %v", fake.aiPrompts)
	}
}

func TestAICustomCommandExpandsArgs(t *testing.T) {
	cfg := runtime.ConfigDTO{
		AIAdaptor: "claude",
		CustomCommands: []runtime.CustomCommand{
			{Name: "test", Instruction: "run $1 and $2"},
		},
	}
	fake := &fakeClient{}
	m := New(fake, cfg)
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true

	m = typeRunes(m, "/test foo bar")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	// The expanded instruction is sent to the agent and shown in the chat.
	if len(fake.aiPrompts) != 1 || fake.aiPrompts[0] != "run foo and bar" {
		t.Fatalf("custom command should expand args for the agent; got %v", fake.aiPrompts)
	}
	last := m.aiMessages[len(m.aiMessages)-1]
	if last.Role != "user" || last.Content != "run foo and bar" {
		t.Fatalf("chat should show the expanded instruction; got %+v", last)
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
	drain(promptCmd)
	if len(fake.aiPrompts) != 1 || fake.aiPrompts[0] != "hi" {
		t.Fatalf("AiPrompt not dispatched: %v", fake.aiPrompts)
	}

	// Stream an agent reply. Thinking stays on for the whole turn — a streamed
	// chunk (and any gap after it) never clears it.
	m, _ = apply(m, AiUpdateMsg{Update: json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}`)})
	if !m.aiThinking {
		t.Fatal("thinking should persist while the turn is in progress")
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

	// The turn stays "thinking" through the whole exchange and only clears when
	// the ACP turn completes (the ai/prompt request resolved → AiTurnDoneMsg).
	if !m.aiThinking {
		t.Fatal("thinking should still be on before the turn completes")
	}
	m, _ = apply(m, AiTurnDoneMsg{ID: m.aiTurnID})
	if m.aiThinking || m.aiPending {
		t.Fatalf("turn completion should clear thinking; thinking=%v pending=%v", m.aiThinking, m.aiPending)
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

func TestFileHighlightCache(t *testing.T) {
	root := t.TempDir()
	content := "url \"https://x\"\ntype get\n"
	if err := os.WriteFile(filepath.Join(root, "get.nts"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(&fakeClient{}, runtime.ConfigDTO{Root: root})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.selectedCommand = "get"
	m.command = "@v"
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})

	if m.mode != modeView || m.fileLines == nil || m.graphqlLines == nil {
		t.Fatalf("view cache not populated: mode=%d lines=%v graphql=%v", m.mode, m.fileLines, m.graphqlLines)
	}
	if strings.Join(m.fileLines, "\n") != content {
		t.Fatalf("fileLines mismatch: %q", m.fileLines)
	}

	// Enter edit mode and type a graphql sugar block; the graphql line map
	// must update as the buffer changes (rev-based invalidation).
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("e")})
	if m.mode != modeEdit {
		t.Fatalf("expected edit mode, got %d", m.mode)
	}
	if len(m.graphqlLines) != 0 {
		t.Fatalf("plain file should have no graphql lines: %v", m.graphqlLines)
	}
	m = typeRunes(m, "query { user }")
	if m.hlRev != m.edit.rev {
		t.Fatalf("cache rev out of sync: hlRev=%d rev=%d", m.hlRev, m.edit.rev)
	}
	if !m.graphqlLines[0] {
		t.Fatalf("expected first line flagged graphql after typing: %v", m.graphqlLines)
	}

	// Esc discards the edits; the view cache must reflect the saved content,
	// not the abandoned edit buffer.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode == modeEdit {
		t.Fatalf("expected to leave edit mode")
	}
	if strings.Join(m.fileLines, "\n") != content {
		t.Fatalf("view cache should match saved content: %q", m.fileLines)
	}
	if len(m.graphqlLines) != 0 {
		t.Fatalf("discarded edits must not leak graphql flags: %v", m.graphqlLines)
	}
}

func aiRefTestModel(t *testing.T) (Model, *fakeClient, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "deep.nts"), []byte("url x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{Root: root, AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true
	return m, fake, root
}

func TestAIRefPopupTriggers(t *testing.T) {
	m, _, _ := aiRefTestModel(t)

	// A standalone #keyword opens the reference popup with the full path.
	m = typeRunes(m, "#deep")
	if !strings.Contains(m.View(), "folder/deep") {
		t.Fatalf("reference popup should list the match:\n%s", m.View())
	}

	// Scenario 1: space between # and text → no macro.
	m.aiInput, m.aiInputCursor = "", 0
	m = typeRunes(m, "# deep")
	if strings.Contains(m.View(), "folder/deep") {
		t.Fatalf("'# deep' must not trigger the popup:\n%s", m.View())
	}

	// Scenario 3: glued # → no macro.
	m.aiInput, m.aiInputCursor = "", 0
	m = typeRunes(m, "abc#deep")
	if strings.Contains(m.View(), "folder/deep") {
		t.Fatalf("'abc#deep' must not trigger the popup:\n%s", m.View())
	}
}

func TestAIRefEscDismisses(t *testing.T) {
	m, _, _ := aiRefTestModel(t)

	m = typeRunes(m, "#deep")
	if !strings.Contains(m.View(), "folder/deep") {
		t.Fatal("popup should be open before Esc")
	}

	// Scenario 2/4: Esc declines the promotion — text stays literal, still in
	// AI mode, popup stays closed for this token.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeAI {
		t.Fatalf("first Esc should dismiss the popup, not leave AI mode; mode=%d", m.mode)
	}
	if m.aiInput != "#deep" {
		t.Fatalf("dismissal must keep the literal text, got %q", m.aiInput)
	}
	if strings.Contains(m.View(), "folder/deep") {
		t.Fatalf("popup should stay closed after Esc:\n%s", m.View())
	}

	// Editing the token re-enables the popup.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyBackspace})
	if !strings.Contains(m.View(), "folder/deep") {
		t.Fatalf("editing the token should reopen the popup:\n%s", m.View())
	}

	// With the popup dismissed again, Esc leaves AI mode as before.
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeQuery {
		t.Fatalf("second Esc should return to query mode; mode=%d", m.mode)
	}
}

func TestAIRefAcceptAndSend(t *testing.T) {
	m, fake, root := aiRefTestModel(t)

	// Enter with the popup open promotes the token to a pill.
	m = typeRunes(m, "#deep")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.aiInput != "[deep.nts] " {
		t.Fatalf("accept should replace the token with the pill, got %q", m.aiInput)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(rootAbs, "folder", "deep.nts")
	if m.aiRefs["deep.nts"] != wantPath {
		t.Fatalf("ref should map to the absolute path, got %q want %q", m.aiRefs["deep.nts"], wantPath)
	}

	// Sending keeps the pill in the text and attaches the file as a reference.
	m = typeRunes(m, "explain this")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	if len(fake.aiPrompts) != 1 {
		t.Fatalf("expected one prompt, got %v", fake.aiPrompts)
	}
	sent := fake.aiPrompts[0]
	if !strings.Contains(sent, "[deep.nts]") || strings.Contains(sent, wantPath) {
		t.Fatalf("sent text should keep the pill and not inline the path, got %q", sent)
	}
	refs := fake.aiPromptRefs[0]
	if len(refs) != 1 || refs[0].Path != wantPath || refs[0].Name != "deep.nts" {
		t.Fatalf("the file should be attached as a reference, got %+v", refs)
	}
	last := m.aiMessages[len(m.aiMessages)-1]
	if last.Role != "user" || !strings.Contains(last.Content, "[deep.nts]") {
		t.Fatalf("transcript should keep the pill, got %+v", last)
	}
	if m.aiRefs != nil {
		t.Fatalf("refs should clear after send, got %v", m.aiRefs)
	}
}

func TestAIRefLabelCollisionFallsBackToPath(t *testing.T) {
	m, _, root := aiRefTestModel(t)
	for _, dir := range []string{"a", "b"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, dir, "x.nts"), []byte("url x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Accept a/x.nts, then b/x.nts: the second pill disambiguates with the path.
	m = typeRunes(m, "#x")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = typeRunes(m, "#x")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})

	if m.aiInput != "[x.nts] [b/x.nts] " {
		t.Fatalf("colliding label should fall back to the relative path, got %q", m.aiInput)
	}
	if m.aiRefs["x.nts"] == m.aiRefs["b/x.nts"] {
		t.Fatalf("refs should point at different files: %v", m.aiRefs)
	}
}

func TestAIRefDirectoryAccept(t *testing.T) {
	m, _, root := aiRefTestModel(t)

	m = typeRunes(m, "#folder")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.aiInput != "[folder] " {
		t.Fatalf("directory accept should use the dir name, got %q", m.aiInput)
	}
	rootAbs, _ := filepath.Abs(root)
	if m.aiRefs["folder"] != filepath.Join(rootAbs, "folder") {
		t.Fatalf("dir ref should map to the directory path, got %v", m.aiRefs)
	}
}

func TestAISteeringSendsMidTurn(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m, _ = apply(m, AiStartedMsg{SupportsSteering: true})
	if !m.aiSteering {
		t.Fatal("AiStartedMsg should set steering support")
	}

	m = typeRunes(m, "first ask")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	firstTurn := m.aiTurnID

	// Mid-turn Enter on a steering adapter sends immediately.
	m = typeRunes(m, "btw check errors too")
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	if len(fake.aiPrompts) != 2 || fake.aiPrompts[1] != "btw check errors too" {
		t.Fatalf("steering should dispatch immediately: %v", fake.aiPrompts)
	}
	if len(m.aiQueue) != 0 {
		t.Fatalf("steering must not queue: %+v", m.aiQueue)
	}
	if m.aiMessages[len(m.aiMessages)-1].Content != "btw check errors too" {
		t.Fatalf("steered tip should be in the transcript: %+v", m.aiMessages)
	}
	if m.aiTurnID != firstTurn+1 {
		t.Fatalf("steering should advance the turn id; got %d", m.aiTurnID)
	}

	// The superseded turn's early end_turn (stale ID) must not clear thinking;
	// the steered turn's completion does.
	m, _ = apply(m, AiTurnDoneMsg{ID: firstTurn})
	if !m.aiThinking {
		t.Fatal("stale hand-off completion must not clear thinking")
	}
	m, _ = apply(m, AiTurnDoneMsg{ID: m.aiTurnID})
	if m.aiThinking || m.aiPending {
		t.Fatal("steered turn completion should clear thinking")
	}
}

func TestAIQueueMidTurnOnNonSteeringAdapter(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "codex"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m, _ = apply(m, AiStartedMsg{SupportsSteering: false})

	m = typeRunes(m, "first ask")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)

	// Mid-turn Enter queues instead of dispatching.
	m = typeRunes(m, "btw tip one")
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	m = typeRunes(m, "and tip two")
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)

	if len(fake.aiPrompts) != 1 {
		t.Fatalf("queued tips must not dispatch mid-turn: %v", fake.aiPrompts)
	}
	if len(m.aiQueue) != 2 || m.aiInput != "" {
		t.Fatalf("tips should queue and clear the input; queue=%+v input=%q", m.aiQueue, m.aiInput)
	}
	for _, msg := range m.aiMessages {
		if msg.Content == "btw tip one" {
			t.Fatal("queued tip must not be in the transcript before it is sent")
		}
	}
	if !strings.Contains(m.View(), "queued: btw tip one") {
		t.Fatalf("queued tips should render as pinned rows:\n%s", m.View())
	}

	// Turn completes → both tips merge into ONE follow-up turn.
	m, cmd = apply(m, AiTurnDoneMsg{ID: m.aiTurnID})
	drain(cmd)
	if len(fake.aiPrompts) != 2 || fake.aiPrompts[1] != "btw tip one\n\nand tip two" {
		t.Fatalf("queued tips should merge into one follow-up: %v", fake.aiPrompts)
	}
	if len(m.aiQueue) != 0 || !m.aiPending || !m.aiThinking {
		t.Fatalf("drain should keep the turn pending; queue=%d pending=%v", len(m.aiQueue), m.aiPending)
	}
	var found int
	for _, msg := range m.aiMessages {
		if msg.Role == "user" && (msg.Content == "btw tip one" || msg.Content == "and tip two") {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("sent tips should now be in the transcript: %+v", m.aiMessages)
	}

	// The follow-up turn's completion clears thinking.
	m, _ = apply(m, AiTurnDoneMsg{ID: m.aiTurnID})
	if m.aiPending || m.aiThinking {
		t.Fatal("final completion should clear thinking")
	}
}

func TestAIQueueCarriesRefsAndStaleGuard(t *testing.T) {
	m, fake, root := aiRefTestModel(t)
	m, _ = apply(m, AiStartedMsg{SupportsSteering: false})

	m = typeRunes(m, "go")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)

	// Queue a tip with a #ref pill mid-turn.
	m = typeRunes(m, "#deep")
	m, _ = apply(m, tea.KeyMsg{Type: tea.KeyEnter}) // accept ref
	m = typeRunes(m, "matters")
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter}) // queue
	drain(cmd)
	if len(m.aiQueue) != 1 || len(m.aiQueue[0].Refs) != 1 {
		t.Fatalf("queued tip should carry its refs: %+v", m.aiQueue)
	}

	// A stale turn-done must not drain the queue.
	m, cmd = apply(m, AiTurnDoneMsg{ID: m.aiTurnID - 1})
	drain(cmd)
	if len(m.aiQueue) != 1 || len(fake.aiPrompts) != 1 {
		t.Fatalf("stale turn-done must not dequeue; queue=%d prompts=%v", len(m.aiQueue), fake.aiPrompts)
	}

	// The real completion drains with refs attached.
	m, cmd = apply(m, AiTurnDoneMsg{ID: m.aiTurnID})
	drain(cmd)
	rootAbs, _ := filepath.Abs(root)
	wantPath := filepath.Join(rootAbs, "folder", "deep.nts")
	refs := fake.aiPromptRefs[len(fake.aiPromptRefs)-1]
	if len(refs) != 1 || refs[0].Path != wantPath {
		t.Fatalf("drained tip should attach its refs: %+v", refs)
	}
}

func TestAIErrorDropsQueue(t *testing.T) {
	fake := &fakeClient{}
	m := New(fake, runtime.ConfigDTO{AIAdaptor: "codex"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true

	m = typeRunes(m, "go")
	m, cmd := apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)
	m = typeRunes(m, "queued tip")
	m, cmd = apply(m, tea.KeyMsg{Type: tea.KeyEnter})
	drain(cmd)

	m, _ = apply(m, AiErrorMsg{Err: context.DeadlineExceeded})
	if len(m.aiQueue) != 0 {
		t.Fatalf("error should drop the queue: %+v", m.aiQueue)
	}
	if !strings.Contains(m.errText, "queued messages dropped") {
		t.Fatalf("dropping the queue should be surfaced: %q", m.errText)
	}
	if len(fake.aiPrompts) != 1 {
		t.Fatalf("no ghost sends after error: %v", fake.aiPrompts)
	}
}

func TestPermissionBannerIsProminent(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{AIAdaptor: "claude"})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 80, Height: 24})
	m.mode = modeAI
	m.aiActive = true

	m, _ = apply(m, AiPermissionMsg{Raw: json.RawMessage(`{"toolCall":{"title":"curl -s https://example.com"},"options":[{"optionId":"a1","kind":"allow_once"},{"optionId":"r1","kind":"reject_once"}]}`)})
	if m.aiPermission == nil {
		t.Fatal("permission should be pending")
	}
	got := m.View()
	for _, want := range []string{"PERMISSION REQUEST", "curl -s https://example.com", "[y] allow", "[n] reject"} {
		if !strings.Contains(got, want) {
			t.Fatalf("banner missing %q:\n%s", want, got)
		}
	}
}

func TestQueryScrollReachesResponseBottom(t *testing.T) {
	m := New(&fakeClient{}, runtime.ConfigDTO{})
	m, _ = apply(m, tea.WindowSizeMsg{Width: 120, Height: 20})

	// A response tall enough to need scrolling, ending in a closing brace.
	res := runtime.ExecuteResult{Status: 200, StatusText: "OK"}
	body := "{\n"
	for i := 0; i < 40; i++ {
		body += fmt.Sprintf("  \"k%d\": %d,\n", i, i)
	}
	body += "  \"last\": true\n}"
	res.Body = json.RawMessage(body)
	m.response = &res
	m.refreshResponseScrollLimits()

	// Scroll to the clamp limit, exactly as the ↓ key does.
	for i := 0; i < m.lastMaxScrollY+5; i++ {
		m, _ = apply(m, tea.KeyMsg{Type: tea.KeyDown})
	}
	if m.scrollY != m.lastMaxScrollY {
		t.Fatalf("scroll should stop at the limit; scrollY=%d max=%d", m.scrollY, m.lastMaxScrollY)
	}

	// The very last content line must be visible at max scroll — the clamp must
	// match the height the pane is actually rendered with (View subtracts the
	// query hint row from the body; the clamp math must too).
	width, height := m.responseViewportDims()
	content := m.responseContent(width)
	lines := strings.Split(content, "\n")
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	visible := m.renderResponse(width, height)
	if !strings.Contains(visible, lastLine) {
		t.Fatalf("last content line %q not reachable at max scroll:\n%s", lastLine, visible)
	}
	if !strings.Contains(m.View(), lastLine) {
		t.Fatalf("full View at max scroll should show the last line %q", lastLine)
	}
}
