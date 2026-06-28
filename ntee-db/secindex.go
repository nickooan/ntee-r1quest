package nteedb

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ValueKind is the type of values held by a secondary index.
type ValueKind int

const (
	KindString ValueKind = iota
	KindNumber
)

func (k ValueKind) String() string {
	if k == KindNumber {
		return "number"
	}
	return "string"
}

// IndexValues maps index names to their values for a single record, e.g.
// {"traceId": "abc", "status": 200}.
type IndexValues = map[string]any

// IndexDef declares a secondary index. Extract is optional: when set, the index
// value for a record is derived automatically from its key and value (the "scan
// itself" mode); when nil, the value must be supplied via PutIndexed. The
// derived/supplied value is persisted in the record so the index can be rebuilt
// at boot without re-reading values.
type IndexDef struct {
	Name    string
	Kind    ValueKind
	Extract func(key string, value []byte) (any, bool)
}

// secEntry is one (value, primary-key) pair in a secondary index. For a string
// index only s is used; for a number index only f is used.
type secEntry struct {
	s  string
	f  float64
	pk string
}

// secIndex is one named secondary index: a slice of entries kept sorted by
// (value, primary key). It mirrors the primary index's sorted-slice approach, so
// exact (multi-value), prefix, and range queries are all bounded binary-search
// walks.
type secIndex struct {
	name    string
	kind    ValueKind
	entries []secEntry
}

func newSecIndex(def IndexDef) *secIndex {
	return &secIndex{name: def.Name, kind: def.Kind}
}

// makeEntry converts a value (string, or any numeric/json.Number) into a typed
// entry for this index, validating it against the index's kind.
func (si *secIndex) makeEntry(val any, pk string) (secEntry, error) {
	e := secEntry{pk: pk}
	switch si.kind {
	case KindNumber:
		f, ok := toFloat(val)
		if !ok {
			return e, fmt.Errorf("nteedb: index %q expects a number, got %T", si.name, val)
		}
		e.f = f
	default: // KindString
		s, ok := val.(string)
		if !ok {
			return e, fmt.Errorf("nteedb: index %q expects a string, got %T", si.name, val)
		}
		e.s = s
	}
	return e, nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// less orders entries by value, then by primary key.
func (si *secIndex) less(a, b secEntry) bool {
	if si.kind == KindNumber {
		if a.f != b.f {
			return a.f < b.f
		}
	} else if a.s != b.s {
		return a.s < b.s
	}
	return a.pk < b.pk
}

func (si *secIndex) valueEqual(a, b secEntry) bool {
	if si.kind == KindNumber {
		return a.f == b.f
	}
	return a.s == b.s
}

func (si *secIndex) lowerBound(e secEntry) int {
	return sort.Search(len(si.entries), func(i int) bool {
		return !si.less(si.entries[i], e)
	})
}

func (si *secIndex) insert(e secEntry) {
	i := si.lowerBound(e)
	if i < len(si.entries) && si.entries[i] == e {
		return // exact duplicate (same value + pk)
	}
	si.entries = append(si.entries, secEntry{})
	copy(si.entries[i+1:], si.entries[i:])
	si.entries[i] = e
}

func (si *secIndex) remove(e secEntry) {
	i := si.lowerBound(e)
	if i < len(si.entries) && si.entries[i] == e {
		si.entries = append(si.entries[:i], si.entries[i+1:]...)
	}
}

// exact returns the primary keys whose index value equals val (multi-value),
// sorted by primary key.
func (si *secIndex) exact(val any) ([]string, error) {
	probe, err := si.makeEntry(val, "")
	if err != nil {
		return nil, err
	}
	var out []string
	for i := si.lowerBound(probe); i < len(si.entries); i++ {
		if !si.valueEqual(si.entries[i], probe) {
			break
		}
		out = append(out, si.entries[i].pk)
	}
	return out, nil
}

// prefix returns the primary keys whose (string) index value starts with p.
func (si *secIndex) prefix(p string) ([]string, error) {
	if si.kind != KindString {
		return nil, fmt.Errorf("nteedb: prefix query requires a string index, %q is %s", si.name, si.kind)
	}
	probe := secEntry{s: p}
	var out []string
	for i := si.lowerBound(probe); i < len(si.entries) && strings.HasPrefix(si.entries[i].s, p); i++ {
		out = append(out, si.entries[i].pk)
	}
	return out, nil
}

// rangeQuery returns the primary keys whose index value is within [lo, hi].
func (si *secIndex) rangeQuery(lo, hi any) ([]string, error) {
	loE, err := si.makeEntry(lo, "")
	if err != nil {
		return nil, err
	}
	hiE, err := si.makeEntry(hi, "")
	if err != nil {
		return nil, err
	}
	var out []string
	for i := si.lowerBound(loE); i < len(si.entries); i++ {
		e := si.entries[i]
		// stop once the value exceeds hi
		if si.kind == KindNumber {
			if e.f > hiE.f {
				break
			}
		} else if e.s > hiE.s {
			break
		}
		out = append(out, e.pk)
	}
	return out, nil
}

// --- DB integration: write path, retraction, and query API ---

// writeLocked appends a record for key and updates the primary and secondary
// indexes. It handles blob offloading for large values. Callers must hold db.mu.
func (db *DB) writeLocked(key string, value []byte, explicit IndexValues) error {
	ix, err := db.buildIndexValues(key, value, explicit)
	if err != nil {
		return err
	}

	// Large values go to the blob side file; the main record just references
	// them. The blob is written (and fsynced in durable mode) before the
	// referencing main record, so a crash can only ever orphan a blob — never
	// leave a main record pointing at a missing one.
	rec := record{Key: key, Value: value, IX: ix}
	if db.useBlobFor(len(value)) {
		ref, err := db.blobs.append(value)
		if err != nil {
			return err
		}
		if db.opts.SyncEveryWrite {
			if err := db.blobs.flush(); err != nil {
				return err
			}
		}
		rec = record{Key: key, Blob: &ref, IX: ix}
	}

	off, n, err := db.log.append(rec)
	if err != nil {
		return err
	}
	db.index.upsert(idxEntry{key: key, off: off, n: n})
	db.refreshSecLocked(key, ix)
	db.writes++
	db.maybeWriteHintLocked()
	return nil
}

// buildIndexValues merges explicit values with values derived from index
// Extract functions, validating each against its index's kind. It returns nil
// when there are no secondary index values for this record.
func (db *DB) buildIndexValues(key string, value []byte, explicit IndexValues) (map[string]any, error) {
	if len(db.secIndexes) == 0 && len(explicit) == 0 {
		return nil, nil
	}
	out := make(map[string]any)
	for name, val := range explicit {
		si := db.secIndexes[name]
		if si == nil {
			return nil, fmt.Errorf("nteedb: unknown index %q", name)
		}
		if _, err := si.makeEntry(val, key); err != nil {
			return nil, err
		}
		out[name] = val
	}
	for _, def := range db.indexDefs {
		if def.Extract == nil {
			continue
		}
		if _, done := out[def.Name]; done {
			continue // explicit value wins
		}
		if v, ok := def.Extract(key, value); ok {
			if _, err := db.secIndexes[def.Name].makeEntry(v, key); err != nil {
				return nil, err
			}
			out[def.Name] = v
		}
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// refreshSecLocked retracts a key's previous secondary entries and applies its
// new ones. It is best-effort (skips unknown indexes / invalid values) so it is
// safe to call during boot replay where the declared index set may differ.
func (db *DB) refreshSecLocked(key string, ix map[string]any) {
	db.retractSecLocked(key)
	if len(ix) == 0 {
		return
	}
	for name, val := range ix {
		si := db.secIndexes[name]
		if si == nil {
			continue
		}
		if e, err := si.makeEntry(val, key); err == nil {
			si.insert(e)
		}
	}
	db.pkSec[key] = ix
}

// retractSecLocked removes a key's current secondary entries (used on overwrite
// and delete). Callers must hold db.mu.
func (db *DB) retractSecLocked(key string) {
	old, ok := db.pkSec[key]
	if !ok {
		return
	}
	for name, val := range old {
		si := db.secIndexes[name]
		if si == nil {
			continue
		}
		if e, err := si.makeEntry(val, key); err == nil {
			si.remove(e)
		}
	}
	delete(db.pkSec, key)
}

// rebuildSecFromPkSec rebuilds all secondary indexes and db.pkSec from the given
// per-key index values (used after a rewrite/compaction/reindex). Builds each
// index's entries then sorts once. Callers must hold db.mu.
func (db *DB) rebuildSecFromPkSec(pkSec map[string]map[string]any) {
	for _, si := range db.secIndexes {
		si.entries = si.entries[:0]
	}
	db.pkSec = make(map[string]map[string]any, len(pkSec))
	for pk, ix := range pkSec {
		db.pkSec[pk] = ix
		for name, val := range ix {
			si := db.secIndexes[name]
			if si == nil {
				continue
			}
			if e, err := si.makeEntry(val, pk); err == nil {
				si.entries = append(si.entries, e)
			}
		}
	}
	for _, si := range db.secIndexes {
		sort.Slice(si.entries, func(i, j int) bool { return si.less(si.entries[i], si.entries[j]) })
	}
}

// ByIndex returns the primary keys whose value in the named index equals val
// (multi-value), sorted by primary key.
func (db *DB) ByIndex(name string, val any) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return nil, fmt.Errorf("nteedb: unknown index %q", name)
	}
	return si.exact(val)
}

// ByIndexPrefix returns the primary keys whose value in the named (string) index
// starts with prefix.
func (db *DB) ByIndexPrefix(name, prefix string) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return nil, fmt.Errorf("nteedb: unknown index %q", name)
	}
	return si.prefix(prefix)
}

// ProspectiveIndexes returns, sorted, the names of declared indexes that have
// not been back-filled over records that existed before the index was added (or
// its kind changed). These indexes cover only records written since; call
// Reindex to populate them over historical data (Extract-based indexes only).
func (db *DB) ProspectiveIndexes() []string {
	db.mu.RLock()
	defer db.mu.RUnlock()
	out := make([]string, 0, len(db.prospective))
	for name := range db.prospective {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// DroppedIndexes returns, sorted, the names of indexes that were dropped from
// the declared set but whose values still linger in records (a soft-drop). They
// remain until a Reindex purges them from records and meta.
func (db *DB) DroppedIndexes() []string {
	db.mu.RLock()
	defer db.mu.RUnlock()
	out := make([]string, 0, len(db.dropped))
	for name := range db.dropped {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// ByIndexRange returns the primary keys whose value in the named index is within
// the inclusive range [lo, hi].
func (db *DB) ByIndexRange(name string, lo, hi any) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return nil, fmt.Errorf("nteedb: unknown index %q", name)
	}
	return si.rangeQuery(lo, hi)
}
