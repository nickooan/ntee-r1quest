package app

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// runCmd fully executes a tea.Cmd (recursing into batches) and applies every
// resulting message to the model, mimicking the Bubble Tea event loop.
func runCmd(t *testing.T, m Model, cmd tea.Cmd) Model {
	t.Helper()
	if cmd == nil {
		return m
	}
	msg := cmd()
	switch v := msg.(type) {
	case nil:
		return m
	case tea.BatchMsg:
		for _, c := range v {
			m = runCmd(t, m, c)
		}
		return m
	default:
		model, next := m.Update(msg)
		m = model.(Model)
		return runCmd(t, m, next)
	}
}

func editModel() Model {
	m := New(&fakeClient{}, runtime.ConfigDTO{Root: "/root"})
	m.openFile = &filetree.OpenViewFile{Path: "/root/a.nts", Content: "A"}
	m.mode = modeEdit
	return m
}

// Undo/redo walks the snapshot timeline; a new edit after an undo drops the
// orphaned redo branch (both in the cursor list and via SnapshotDelete).
func TestUndoRedoTimeline(t *testing.T) {
	m := editModel()
	client := m.client.(*fakeClient)

	var cmd tea.Cmd
	m, cmd = m.beginEditSession("A") // baseline snapshot "A"
	m = runCmd(t, m, cmd)
	m.edit.cx = len(m.edit.line()) // cursor at end so inserts append

	m.edit.insert("B")
	m.snapDirty = true
	m, cmd = m.pushSnapshot("edit") // checkpoint "AB"
	m = runCmd(t, m, cmd)

	m.edit.insert("C") // "ABC", not yet checkpointed
	m.snapDirty = true

	// Undo flushes "ABC" then loads "AB".
	m, cmd = m.undo()
	m = runCmd(t, m, cmd)
	if got := m.edit.content(); got != "AB" {
		t.Fatalf("after 1st undo: got %q, want %q", got, "AB")
	}

	// Undo again → baseline "A".
	m, cmd = m.undo()
	m = runCmd(t, m, cmd)
	if got := m.edit.content(); got != "A" {
		t.Fatalf("after 2nd undo: got %q, want %q", got, "A")
	}

	// Redo → "AB".
	m, cmd = m.redo()
	m = runCmd(t, m, cmd)
	if got := m.edit.content(); got != "AB" {
		t.Fatalf("after redo: got %q, want %q", got, "AB")
	}

	// A new edit here must discard the forward "ABC" branch.
	delsBefore := len(client.snapshotDels)
	m.edit.insert("X") // "ABX"
	m.snapDirty = true
	m, cmd = m.pushSnapshot("edit")
	m = runCmd(t, m, cmd)
	if len(client.snapshotDels) <= delsBefore {
		t.Fatalf("new edit after undo did not delete the redo branch")
	}

	// Redo now does nothing (branch gone).
	before := m.edit.content()
	m, cmd = m.redo()
	m = runCmd(t, m, cmd)
	if got := m.edit.content(); got != before {
		t.Fatalf("redo after truncation changed content: %q -> %q", before, got)
	}
}

// The snapshot store cap is mirrored in the TUI: the tracked seq list never
// grows past maxSnapshots.
func TestUndoListCappedAtMax(t *testing.T) {
	m := editModel()
	var cmd tea.Cmd
	m, cmd = m.beginEditSession("v")
	m = runCmd(t, m, cmd)

	for i := 0; i < maxSnapshots+10; i++ {
		m.edit.insert("x")
		m.snapDirty = true
		m, cmd = m.pushSnapshot("edit")
		m = runCmd(t, m, cmd)
	}
	if len(m.undoSeqs) > maxSnapshots {
		t.Fatalf("undoSeqs grew to %d, want <= %d", len(m.undoSeqs), maxSnapshots)
	}
	if m.undoCursor != len(m.undoSeqs)-1 {
		t.Fatalf("cursor %d not at head %d", m.undoCursor, len(m.undoSeqs)-1)
	}
}
