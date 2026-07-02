package nteedb

import (
	"testing"
)

func mustOpen(t *testing.T, dir string) *DB {
	t.Helper()
	db, err := Open(Options{Dir: dir})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return db
}

func mustGet(t *testing.T, db *DB, key string) (string, bool) {
	t.Helper()
	v, ok, err := db.Get(key)
	if err != nil {
		t.Fatalf("get(%q): %v", key, err)
	}
	return string(v), ok
}

func TestPutGetDelete(t *testing.T) {
	db := mustOpen(t, t.TempDir())
	defer db.Close()

	if err := db.Put("alpha", []byte("one")); err != nil {
		t.Fatal(err)
	}
	if err := db.Put("beta", []byte("two")); err != nil {
		t.Fatal(err)
	}

	if v, ok := mustGet(t, db, "alpha"); !ok || v != "one" {
		t.Errorf("alpha = %q %v", v, ok)
	}
	if !db.Has("beta") {
		t.Error("Has(beta) = false")
	}
	if _, ok := mustGet(t, db, "missing"); ok {
		t.Error("missing should be absent")
	}

	// Overwrite.
	if err := db.Put("alpha", []byte("ONE")); err != nil {
		t.Fatal(err)
	}
	if v, _ := mustGet(t, db, "alpha"); v != "ONE" {
		t.Errorf("after overwrite alpha = %q", v)
	}

	// Delete.
	if err := db.Delete("alpha"); err != nil {
		t.Fatal(err)
	}
	if _, ok := mustGet(t, db, "alpha"); ok {
		t.Error("alpha should be deleted")
	}
	if db.Has("alpha") {
		t.Error("Has(alpha) should be false after delete")
	}
	// Deleting an absent key is a no-op.
	if err := db.Delete("alpha"); err != nil {
		t.Fatal(err)
	}
}

func TestReopenRestoresState(t *testing.T) {
	dir := t.TempDir()

	db := mustOpen(t, dir)
	db.Put("a", []byte("1"))
	db.Put("b", []byte("2"))
	db.Put("a", []byte("11")) // overwrite
	db.Put("c", []byte("3"))
	db.Delete("b") // tombstone
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	// Reopen: index must be rebuilt from the log alone.
	db2 := mustOpen(t, dir)
	defer db2.Close()

	if v, ok := mustGet(t, db2, "a"); !ok || v != "11" {
		t.Errorf("a = %q %v, want 11", v, ok)
	}
	if _, ok := mustGet(t, db2, "b"); ok {
		t.Error("b should remain deleted after reopen")
	}
	if v, ok := mustGet(t, db2, "c"); !ok || v != "3" {
		t.Errorf("c = %q %v", v, ok)
	}
}

func TestPrefixScanEndToEnd(t *testing.T) {
	db := mustOpen(t, t.TempDir())
	defer db.Close()

	for _, k := range []string{"input:Get", "input:GetProperty", "input:GetPropertyNames", "api:/orders", "input:SetX"} {
		if err := db.Put(k, []byte("v")); err != nil {
			t.Fatal(err)
		}
	}

	got, err := db.PrefixScan("input:GetP")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"input:GetProperty", "input:GetPropertyNames"}
	if !eqStrs(got, want) {
		t.Errorf("PrefixScan(input:GetP) = %v, want %v", got, want)
	}

	// Namespace grouping via prefix.
	all, _ := db.PrefixScan("input:")
	if len(all) != 4 {
		t.Errorf("input: namespace has %d keys, want 4: %v", len(all), all)
	}
}

func TestOperationsAfterCloseError(t *testing.T) {
	db := mustOpen(t, t.TempDir())
	db.Close()
	if err := db.Put("x", []byte("y")); err != ErrClosed {
		t.Errorf("Put after close = %v, want ErrClosed", err)
	}
	if _, _, err := db.Get("x"); err != ErrClosed {
		t.Errorf("Get after close = %v, want ErrClosed", err)
	}
}
