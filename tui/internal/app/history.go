package app

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// maxSnapshots bounds the undo timeline the TUI tracks per edit session. The
// runtime enforces the same cap (MAX_VERSIONS_PER_FILE) on the stored side.
const maxSnapshots = 50

// snapshotLoadedMsg carries the content of a snapshot fetched for undo/redo.
type snapshotLoadedMsg struct {
	ok      bool
	content string
}

// beginEditSession resets the undo timeline for a freshly-opened editor and
// records the baseline snapshot (the on-disk content).
func (m Model) beginEditSession(content string) (Model, tea.Cmd) {
	m.edit = newEditor(content)
	m.undoSeqs = nil
	m.undoCursor = 0
	m.snapDirty = false
	return m.pushSnapshot("edit")
}

// pushSnapshot checkpoints the current editor content: it drops any redo branch
// (deleting those orphaned snapshots), appends a new snapshot seq, and persists
// it via the runtime. kind is "edit" for coalesced bursts or "save" for saves.
func (m Model) pushSnapshot(kind string) (Model, tea.Cmd) {
	if m.openFile == nil {
		return m, nil
	}
	var cmds []tea.Cmd

	// A new edit after an undo discards the now-orphaned forward snapshots.
	if m.undoCursor < len(m.undoSeqs)-1 {
		dropped := append([]int64(nil), m.undoSeqs[m.undoCursor+1:]...)
		m.undoSeqs = m.undoSeqs[:m.undoCursor+1]
		cmds = append(cmds, snapshotDeleteCmd(m.client, dropped))
	}

	seq := time.Now().UnixMilli()
	if seq <= m.nextSeq {
		seq = m.nextSeq + 1 // keep seqs strictly increasing (= save order)
	}
	m.nextSeq = seq

	content := m.edit.content()
	m.undoSeqs = append(m.undoSeqs, seq)
	if len(m.undoSeqs) > maxSnapshots {
		m.undoSeqs = append([]int64(nil), m.undoSeqs[len(m.undoSeqs)-maxSnapshots:]...)
	}
	m.undoCursor = len(m.undoSeqs) - 1
	m.snapDirty = false

	cmds = append(cmds, snapshotPutCmd(m.client, m.openFile.Path, seq, kind, content))
	return m, tea.Batch(cmds...)
}

// flushBurst checkpoints the current content if edits are pending since the last
// snapshot; a no-op otherwise. Called at burst boundaries (e.g. cursor moves).
func (m Model) flushBurst() (Model, tea.Cmd) {
	if m.snapDirty {
		return m.pushSnapshot("edit")
	}
	return m, nil
}

// undo flushes any un-checkpointed edits (so redo can return to them), then
// steps back one snapshot, fetching its content to load into the editor.
func (m Model) undo() (Model, tea.Cmd) {
	var cmds []tea.Cmd
	if m.snapDirty {
		var c tea.Cmd
		m, c = m.pushSnapshot("edit")
		cmds = append(cmds, c)
	}
	if m.undoCursor > 0 {
		m.undoCursor--
		cmds = append(cmds, snapshotGetCmd(m.client, m.undoSeqs[m.undoCursor]))
	}
	return m, tea.Batch(cmds...)
}

// redo steps forward one snapshot, if the timeline has one.
func (m Model) redo() (Model, tea.Cmd) {
	if m.undoCursor < len(m.undoSeqs)-1 {
		m.undoCursor++
		return m, snapshotGetCmd(m.client, m.undoSeqs[m.undoCursor])
	}
	return m, nil
}

func snapshotPutCmd(client runtimeClient, path string, seq int64, kind, content string) tea.Cmd {
	return func() tea.Msg {
		_ = client.SnapshotPut(path, seq, kind, content) // best-effort
		return nil
	}
}

func snapshotDeleteCmd(client runtimeClient, seqs []int64) tea.Cmd {
	return func() tea.Msg {
		_ = client.SnapshotDelete(seqs)
		return nil
	}
}

func snapshotGetCmd(client runtimeClient, seq int64) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		rec, ok, err := client.SnapshotGet(ctx, seq)
		if err != nil || !ok {
			return snapshotLoadedMsg{ok: false}
		}
		return snapshotLoadedMsg{ok: true, content: rec.Content}
	}
}
