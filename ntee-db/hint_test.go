package nteedb

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHintFastPathBoot(t *testing.T) {
	dir := t.TempDir()
	db := mustOpen(t, dir)
	db.Put("a", []byte("1"))
	db.Put("b", []byte("2"))
	db.Close() // writes a hint covering everything

	// A hint file must now exist.
	if _, err := os.Stat(filepath.Join(dir, hintFile)); err != nil {
		t.Fatalf("hint file missing after Close: %v", err)
	}

	db2 := mustOpen(t, dir)
	defer db2.Close()
	if v, ok := mustGet(t, db2, "a"); !ok || v != "1" {
		t.Errorf("a = %q %v", v, ok)
	}
	if v, ok := mustGet(t, db2, "b"); !ok || v != "2" {
		t.Errorf("b = %q %v", v, ok)
	}
}

func TestHintStaleThenTailReplay(t *testing.T) {
	dir := t.TempDir()

	// Write a hint covering only {a}, then append more records WITHOUT updating
	// the hint, to simulate writes after the last checkpoint.
	db := mustOpen(t, dir)
	db.Put("a", []byte("1"))
	if err := db.writeHintLocked(); err != nil { // checkpoint at {a}
		t.Fatal(err)
	}
	db.Put("b", []byte("2"))
	db.Put("a", []byte("11")) // overwrite after checkpoint
	// Close writes a fresh full hint, so to keep the hint stale we bypass it:
	db.log.flush()
	db.log.close()
	db.rf.Close()
	db.closed = true

	// Reopen: hint covers only {a}@old; boot must replay the tail to pick up
	// {b} and the {a} overwrite.
	db2 := mustOpen(t, dir)
	defer db2.Close()
	if v, ok := mustGet(t, db2, "a"); !ok || v != "11" {
		t.Errorf("a = %q %v, want 11 (tail overwrite applied)", v, ok)
	}
	if v, ok := mustGet(t, db2, "b"); !ok || v != "2" {
		t.Errorf("b = %q %v, want 2 (tail record applied)", v, ok)
	}
}

func TestCorruptHintFallsBackToFullScan(t *testing.T) {
	dir := t.TempDir()
	db := mustOpen(t, dir)
	db.Put("a", []byte("1"))
	db.Put("b", []byte("2"))
	db.Close()

	// Corrupt the hint file.
	if err := os.WriteFile(filepath.Join(dir, hintFile), []byte("not json at all\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	db2 := mustOpen(t, dir) // must full-scan and still be correct
	defer db2.Close()
	if v, ok := mustGet(t, db2, "a"); !ok || v != "1" {
		t.Errorf("a = %q %v", v, ok)
	}
	if v, ok := mustGet(t, db2, "b"); !ok || v != "2" {
		t.Errorf("b = %q %v", v, ok)
	}
}

func TestHintAheadOfLogIgnored(t *testing.T) {
	dir := t.TempDir()
	db := mustOpen(t, dir)
	db.Put("a", []byte("1"))
	db.Close()

	// Forge a hint whose covers watermark is past the end of the log.
	ix := newIndex()
	ix.upsert(idxEntry{key: "ghost", off: 0, n: 5})
	if err := writeHint(filepath.Join(dir, hintFile), ix, nil, 1<<30); err != nil {
		t.Fatal(err)
	}

	db2 := mustOpen(t, dir) // covers > size → ignore hint, full-scan
	defer db2.Close()
	if db2.Has("ghost") {
		t.Error("ghost key from bogus hint should not be present")
	}
	if v, ok := mustGet(t, db2, "a"); !ok || v != "1" {
		t.Errorf("a = %q %v", v, ok)
	}
}

func TestPeriodicHintEveryN(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(Options{Dir: dir, HintEveryN: 2})
	if err != nil {
		t.Fatal(err)
	}
	db.Put("a", []byte("1")) // write 1
	db.Put("b", []byte("2")) // write 2 → hint flushed here
	hintPath := filepath.Join(dir, hintFile)
	entries, covers, ok := loadHint(hintPath)
	if !ok {
		t.Fatal("expected a hint after HintEveryN writes")
	}
	if len(entries) != 2 || covers <= 0 {
		t.Errorf("hint entries=%d covers=%d, want 2 entries and positive covers", len(entries), covers)
	}
	db.Close()
}
