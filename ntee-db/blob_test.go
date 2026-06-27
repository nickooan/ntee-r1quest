package nteedb

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestLargeValueGoesToBlob(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(Options{Dir: dir, BlobThreshold: 32})
	if err != nil {
		t.Fatal(err)
	}

	small := []byte("tiny")
	big := bytes.Repeat([]byte("X"), 1024) // > threshold

	if err := db.Put("small", small); err != nil {
		t.Fatal(err)
	}
	if err := db.Put("big", big); err != nil {
		t.Fatal(err)
	}

	// The big value must have been written to blobs.dat.
	bi, err := os.Stat(filepath.Join(dir, blobFile))
	if err != nil {
		t.Fatal(err)
	}
	if bi.Size() < int64(len(big)) {
		t.Errorf("blobs.dat size %d, expected >= %d", bi.Size(), len(big))
	}

	if v, ok, _ := db.Get("small"); !ok || !bytes.Equal(v, small) {
		t.Errorf("small mismatch")
	}
	if v, ok, _ := db.Get("big"); !ok || !bytes.Equal(v, big) {
		t.Errorf("big mismatch (len got/want)")
	}
	db.Close()

	// Reopen: blob-backed value must survive and be readable.
	db2, err := Open(Options{Dir: dir, BlobThreshold: 32})
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	if v, ok, _ := db2.Get("big"); !ok || !bytes.Equal(v, big) {
		t.Errorf("big value not recovered after reopen")
	}
}

func TestMainLogStaysSmallWithBlobs(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(Options{Dir: dir, BlobThreshold: 64})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	big := bytes.Repeat([]byte("Z"), 100<<10) // 100 KiB
	if err := db.Put("upload", big); err != nil {
		t.Fatal(err)
	}

	// The main log line should be tiny (just key + blob ref), not ~100 KiB,
	// which keeps boot replay cheap.
	mi, _ := os.Stat(filepath.Join(dir, mainFile))
	if mi.Size() > 256 {
		t.Errorf("main log line is %d bytes; expected small (blob ref only)", mi.Size())
	}
}
