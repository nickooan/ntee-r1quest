package filetree

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadAndWriteViewFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "get.nts"), []byte("url example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	of, ok := ReadViewFile(root, "get.nts")
	if !ok || of.FileName != "get.nts" || of.Content != "url example.com\n" {
		t.Fatalf("read: ok=%v file=%+v", ok, of)
	}

	if err := WriteViewFile(of.Path, "url changed.com\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	again, _ := ReadViewFile(root, "get.nts")
	if again.Content != "url changed.com\n" {
		t.Fatalf("after write: %q", again.Content)
	}
}

func TestReadViewFileJailed(t *testing.T) {
	root := t.TempDir()
	if _, ok := ReadViewFile(root, "../../etc/passwd"); ok {
		t.Fatal("path escaping the root must be rejected")
	}
}
