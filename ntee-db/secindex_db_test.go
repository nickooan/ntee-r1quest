package nteedb

import (
	"encoding/json"
	"testing"
)

func openIndexed(t *testing.T, dir string) *DB {
	t.Helper()
	db, err := Open(Options{
		Dir: dir,
		Indexes: []IndexDef{
			{Name: "traceId", Kind: KindString},
			{Name: "status", Kind: KindNumber},
		},
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return db
}

func mustBy(t *testing.T, db *DB, name string, val any) []string {
	t.Helper()
	got, err := db.ByIndex(name, val)
	if err != nil {
		t.Fatalf("ByIndex(%s,%v): %v", name, val, err)
	}
	return got
}

func TestSecondaryMultiValueTraceId(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	db.PutIndexed("call:1", []byte("a"), IndexValues{"traceId": "T1", "status": 200})
	db.PutIndexed("call:2", []byte("b"), IndexValues{"traceId": "T1", "status": 404})
	db.PutIndexed("call:3", []byte("c"), IndexValues{"traceId": "T2", "status": 200})

	if got := mustBy(t, db, "traceId", "T1"); !eqStrs(got, []string{"call:1", "call:2"}) {
		t.Errorf("traceId T1 = %v, want [call:1 call:2]", got)
	}
	if got := mustBy(t, db, "traceId", "T2"); !eqStrs(got, []string{"call:3"}) {
		t.Errorf("traceId T2 = %v", got)
	}

	// Deleting one record retracts it from the index.
	db.Delete("call:1")
	if got := mustBy(t, db, "traceId", "T1"); !eqStrs(got, []string{"call:2"}) {
		t.Errorf("after delete traceId T1 = %v, want [call:2]", got)
	}
}

func TestSecondaryOverwriteRetraction(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	db.PutIndexed("k", []byte("v1"), IndexValues{"traceId": "OLD"})
	if got := mustBy(t, db, "traceId", "OLD"); !eqStrs(got, []string{"k"}) {
		t.Fatalf("OLD = %v", got)
	}

	// Overwrite with a new index value: the old mapping must disappear.
	db.PutIndexed("k", []byte("v2"), IndexValues{"traceId": "NEW"})
	if got := mustBy(t, db, "traceId", "OLD"); len(got) != 0 {
		t.Errorf("OLD should be empty after overwrite, got %v", got)
	}
	if got := mustBy(t, db, "traceId", "NEW"); !eqStrs(got, []string{"k"}) {
		t.Errorf("NEW = %v, want [k]", got)
	}
}

func TestSecondaryNumberRangeAndPrefix(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	db.PutIndexed("a", []byte("x"), IndexValues{"status": 200, "traceId": "GetOrders"})
	db.PutIndexed("b", []byte("x"), IndexValues{"status": 204, "traceId": "GetProperty"})
	db.PutIndexed("c", []byte("x"), IndexValues{"status": 500, "traceId": "SetX"})

	got, err := db.ByIndexRange("status", 200, 299)
	if err != nil {
		t.Fatal(err)
	}
	if !eqStrs(got, []string{"a", "b"}) {
		t.Errorf("status range 200-299 = %v, want [a b]", got)
	}

	pre, err := db.ByIndexPrefix("traceId", "Get")
	if err != nil {
		t.Fatal(err)
	}
	if !eqStrs(pre, []string{"a", "b"}) {
		t.Errorf("traceId prefix Get = %v, want [a b]", pre)
	}
}

// TestSecondaryPrefixGroupedLimit exercises the grouped +/-N limit end-to-end:
// a prefix spanning two endpoints returns the latest (or first) record of each.
func TestSecondaryPrefixGroupedLimit(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	// GetXXXMutation has two records; GetXXXMumu one. Primary keys encode order.
	db.PutIndexed("call:1", []byte("x"), IndexValues{"traceId": "GetXXXMutation"})
	db.PutIndexed("call:2", []byte("x"), IndexValues{"traceId": "GetXXXMutation"})
	db.PutIndexed("call:3", []byte("x"), IndexValues{"traceId": "GetXXXMumu"})

	// -1: last record of each endpoint (groups ascending by value).
	if got, _ := db.ByIndexPrefix("traceId", "GetXXXM", -1); !eqStrs(got, []string{"call:3", "call:2"}) {
		t.Errorf("prefix GetXXXM limit -1 = %v, want [call:3 call:2]", got)
	}
	// 0: full flat collection in (value, pk) order.
	if got, _ := db.ByIndexPrefix("traceId", "GetXXXM", 0); !eqStrs(got, []string{"call:3", "call:1", "call:2"}) {
		t.Errorf("prefix GetXXXM limit 0 = %v, want [call:3 call:1 call:2]", got)
	}
	// Omitted limit behaves like 0 (all).
	if got, _ := db.ByIndexPrefix("traceId", "GetXXXM"); !eqStrs(got, []string{"call:3", "call:1", "call:2"}) {
		t.Errorf("prefix GetXXXM no limit = %v, want [call:3 call:1 call:2]", got)
	}
}

func TestSecondaryRebuildAfterReopen(t *testing.T) {
	dir := t.TempDir()
	db := openIndexed(t, dir)
	db.PutIndexed("call:1", []byte("a"), IndexValues{"traceId": "T1", "status": 200})
	db.PutIndexed("call:2", []byte("b"), IndexValues{"traceId": "T1", "status": 500})
	db.Close()

	// Reopen: secondary indexes must be rebuilt from the persisted ix fields,
	// with no extractors needed.
	db2 := openIndexed(t, dir)
	defer db2.Close()
	if got := mustBy(t, db2, "traceId", "T1"); !eqStrs(got, []string{"call:1", "call:2"}) {
		t.Errorf("after reopen traceId T1 = %v", got)
	}
	if got, _ := db2.ByIndexRange("status", 500, 599); !eqStrs(got, []string{"call:2"}) {
		t.Errorf("after reopen status 500-599 = %v", got)
	}
}

func TestSecondaryCompactionPreserves(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	db.PutIndexed("call:1", []byte("a"), IndexValues{"traceId": "T1"})
	db.PutIndexed("call:1", []byte("a2"), IndexValues{"traceId": "T1"}) // dead record
	db.PutIndexed("call:2", []byte("b"), IndexValues{"traceId": "T1"})

	if err := db.Compact(); err != nil {
		t.Fatal(err)
	}
	if got := mustBy(t, db, "traceId", "T1"); !eqStrs(got, []string{"call:1", "call:2"}) {
		t.Errorf("after compaction traceId T1 = %v", got)
	}
}

func TestSecondaryExtractor(t *testing.T) {
	// An index that derives its value from the record's JSON body.
	dir := t.TempDir()
	def := IndexDef{
		Name: "kind",
		Kind: KindString,
		Extract: func(key string, value []byte) (any, bool) {
			var m struct {
				Kind string `json:"kind"`
			}
			if json.Unmarshal(value, &m) != nil || m.Kind == "" {
				return nil, false
			}
			return m.Kind, true
		},
	}
	db, err := Open(Options{Dir: dir, Indexes: []IndexDef{def}})
	if err != nil {
		t.Fatal(err)
	}

	// Plain Put — the extractor derives "kind" automatically.
	db.Put("r1", []byte(`{"kind":"request"}`))
	db.Put("r2", []byte(`{"kind":"history"}`))
	db.Put("r3", []byte(`{"kind":"request"}`))

	if got := mustBy(t, db, "kind", "request"); !eqStrs(got, []string{"r1", "r3"}) {
		t.Errorf("kind=request = %v, want [r1 r3]", got)
	}
	db.Close()

	// Reopen WITHOUT the extractor: index still rebuilds from persisted ix.
	db2, err := Open(Options{Dir: dir, Indexes: []IndexDef{{Name: "kind", Kind: KindString}}})
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	if got := mustBy(t, db2, "kind", "history"); !eqStrs(got, []string{"r2"}) {
		t.Errorf("after reopen kind=history = %v, want [r2]", got)
	}
}

func TestSecondaryErrors(t *testing.T) {
	db := openIndexed(t, t.TempDir())
	defer db.Close()

	// Unknown index name.
	if err := db.PutIndexed("k", []byte("v"), IndexValues{"nope": "x"}); err == nil {
		t.Error("expected error for unknown index")
	}
	// Wrong value kind (string into number index).
	if err := db.PutIndexed("k", []byte("v"), IndexValues{"status": "not-a-number"}); err == nil {
		t.Error("expected error for wrong value kind")
	}
	// A failed PutIndexed must not have written anything.
	if db.Has("k") {
		t.Error("k must not exist after a rejected PutIndexed")
	}
	// Query on unknown index errors.
	if _, err := db.ByIndex("nope", "x"); err == nil {
		t.Error("expected error querying unknown index")
	}
}

func TestSecondaryDuplicateNameRejected(t *testing.T) {
	_, err := Open(Options{
		Dir:     t.TempDir(),
		Indexes: []IndexDef{{Name: "x", Kind: KindString}, {Name: "x", Kind: KindNumber}},
	})
	if err == nil {
		t.Error("expected error for duplicate index name")
	}
}
