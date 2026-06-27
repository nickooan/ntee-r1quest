package nteedb

import (
	"sort"
	"testing"
)

func keysOf(es []idxEntry) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.key
	}
	return out
}

func eqStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestIndexExactAndUpsert(t *testing.T) {
	ix := newIndex()
	ix.upsert(idxEntry{key: "b", off: 10, n: 5})
	ix.upsert(idxEntry{key: "a", off: 0, n: 4})
	ix.upsert(idxEntry{key: "c", off: 20, n: 6})

	if keys := keysOf(ix.entries); !eqStrs(keys, []string{"a", "b", "c"}) {
		t.Fatalf("not sorted: %v", keys)
	}

	e, ok := ix.get("b")
	if !ok || e.off != 10 {
		t.Fatalf("get(b) = %+v %v", e, ok)
	}

	// Upsert of an existing key updates the location in place (no growth).
	ix.upsert(idxEntry{key: "b", off: 99, n: 7})
	if ix.len() != 3 {
		t.Fatalf("len after update = %d, want 3", ix.len())
	}
	if e, _ := ix.get("b"); e.off != 99 {
		t.Fatalf("b not updated: %+v", e)
	}

	if _, ok := ix.get("missing"); ok {
		t.Error("get(missing) should be false")
	}
}

func TestIndexRemove(t *testing.T) {
	ix := newIndex()
	for _, k := range []string{"a", "b", "c"} {
		ix.upsert(idxEntry{key: k})
	}
	if !ix.remove("b") {
		t.Error("remove(b) should report true")
	}
	if ix.remove("b") {
		t.Error("second remove(b) should report false")
	}
	if keys := keysOf(ix.entries); !eqStrs(keys, []string{"a", "c"}) {
		t.Fatalf("after remove: %v", keys)
	}
}

func TestIndexPrefix(t *testing.T) {
	ix := newIndex()
	for _, k := range []string{"Get", "GetProperty", "GetPropertyNames", "GetX", "SetX"} {
		ix.upsert(idxEntry{key: k})
	}

	cases := []struct {
		prefix string
		want   []string
	}{
		{"GetP", []string{"GetProperty", "GetPropertyNames"}},
		{"Get", []string{"Get", "GetProperty", "GetPropertyNames", "GetX"}},
		{"GetProperty", []string{"GetProperty", "GetPropertyNames"}},
		{"Set", []string{"SetX"}},
		{"Z", nil},
		{"", []string{"Get", "GetProperty", "GetPropertyNames", "GetX", "SetX"}},
	}
	for _, tc := range cases {
		if got := keysOf(ix.prefix(tc.prefix)); !eqStrs(got, tc.want) {
			t.Errorf("prefix(%q) = %v, want %v", tc.prefix, got, tc.want)
		}
	}
}

func TestIndexStaysSortedRandomInserts(t *testing.T) {
	ix := newIndex()
	// Insert in a scrambled order; the slice must remain sorted throughout.
	for _, k := range []string{"m", "a", "z", "q", "b", "y", "c", "n", "a", "z"} {
		ix.upsert(idxEntry{key: k})
		keys := keysOf(ix.entries)
		if !sort.StringsAreSorted(keys) {
			t.Fatalf("not sorted after inserting %q: %v", k, keys)
		}
	}
	// Duplicates ("a","z") must not create extra entries.
	if ix.len() != 8 {
		t.Fatalf("len = %d, want 8 unique keys", ix.len())
	}
}
