package filetree

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "folder-a"))
	mustMkdir(t, filepath.Join(root, "folder-a", "nested"))
	mustWrite(t, filepath.Join(root, "folder-a", "get-one.nts"))
	mustWrite(t, filepath.Join(root, "folder-a", "nested", "deep.nts"))
	mustWrite(t, filepath.Join(root, "top.nts"))
	mustWrite(t, filepath.Join(root, "notes.txt"))
	return root
}

func mustMkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, p string) {
	t.Helper()
	if err := os.WriteFile(p, []byte("url example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBuildFileTreeEntriesCollapsed(t *testing.T) {
	root := writeTree(t)
	entries := BuildFileTreeEntries(root, nil)

	// Directories first (folder-a), then requests/files at root: top.nts, notes.txt.
	if len(entries) != 3 {
		t.Fatalf("want 3 top-level entries, got %d: %+v", len(entries), entries)
	}
	// Directories first, then files by name: folder-a/, notes.txt, top.nts.
	if entries[0].Name != "folder-a" || entries[0].Type != "directory" || entries[0].CommandValue != "folder-a/" {
		t.Fatalf("first entry: %+v", entries[0])
	}
	if entries[1].Name != "notes.txt" || entries[1].Type != "file" {
		t.Fatalf("file entry: %+v", entries[1])
	}
	if entries[2].Name != "top.nts" || entries[2].Type != "request" || entries[2].CommandValue != "top" {
		t.Fatalf("request entry: %+v", entries[2])
	}
}

func TestBuildExpandedDirectoryPaths(t *testing.T) {
	got := BuildExpandedDirectoryPaths("folder-a/nested/deep")
	if !got["folder-a"] || !got["folder-a/nested"] || got["folder-a/nested/deep"] {
		t.Fatalf("expanded paths: %+v", got)
	}

	gotDir := BuildExpandedDirectoryPaths("folder-a/")
	if !gotDir["folder-a"] {
		t.Fatalf("trailing slash should expand folder-a: %+v", gotDir)
	}
}

func TestBuildFileTreeEntriesExpands(t *testing.T) {
	root := writeTree(t)
	expanded := BuildExpandedDirectoryPaths("folder-a/")
	entries := BuildFileTreeEntries(root, expanded)

	var names []string
	for _, e := range entries {
		names = append(names, e.CommandValue)
	}
	// folder-a/ expanded reveals nested/ and get-one.
	want := map[string]bool{"folder-a/": true, "folder-a/nested/": true, "folder-a/get-one": true}
	found := 0
	for _, n := range names {
		if want[n] {
			found++
		}
	}
	if found != len(want) {
		t.Fatalf("expanded names missing; got %v", names)
	}
}

func TestFindFileTreeMatchIndex(t *testing.T) {
	root := writeTree(t)
	entries := BuildFileTreeEntries(root, BuildExpandedDirectoryPaths("folder-a/"))

	// Exact command match wins.
	idx := FindFileTreeMatchIndex(entries, "folder-a/get-one")
	if idx < 0 || entries[idx].CommandValue != "folder-a/get-one" {
		t.Fatalf("expected exact match, got idx %d", idx)
	}

	// @-commands never match the tree.
	if FindFileTreeMatchIndex(entries, "@query") != -1 {
		t.Fatal("@-commands should not match")
	}
}

func TestFormatFileTreeEntryLabel(t *testing.T) {
	dir := FileTreeEntry{Name: "folder-a", Depth: 0, Type: "directory", IsExpanded: true}
	if got := FormatFileTreeEntryLabel(dir, 12); got != "↓ folder-a  " {
		t.Fatalf("dir label: %q", got)
	}
	req := FileTreeEntry{Name: "get.nts", Depth: 1, Type: "request"}
	if got := FormatFileTreeEntryLabel(req, 14); got != "    get.nts   " {
		t.Fatalf("request label: %q", got)
	}
}
