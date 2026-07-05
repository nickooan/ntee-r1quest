package nteedb

import (
	"encoding/json"
	"fmt"
	"sort"
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
//
// MaxPerValue, when > 0, caps how many records may share one value in this
// index. A write that pushes a value's group over the cap evicts the oldest
// record(s) — lowest primary key within the group — as a full, durable delete
// (tombstone; the record leaves the primary index and every secondary index).
// "Oldest" therefore relies on the caller designing time-ordered keys (see the
// README's key-design section). 0 or negative = unlimited. Enforced on the
// write path only: not during boot replay or Reindex back-fill, but a group
// left over the cap (e.g. after lowering it) is drained by the next write to
// that value.
type IndexDef struct {
	Name        string
	Kind        ValueKind
	Extract     func(key string, value []byte) (any, bool)
	MaxPerValue int
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
	max     int // cap on records per distinct value; <= 0 = unlimited
	entries []secEntry
}

func newSecIndex(def IndexDef) *secIndex {
	return &secIndex{name: def.Name, kind: def.Kind, max: def.MaxPerValue}
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

// valueGreater reports whether a's value is strictly greater than b's (ignoring
// the primary key).
func (si *secIndex) valueGreater(a, b secEntry) bool {
	if si.kind == KindNumber {
		return a.f > b.f
	}
	return a.s > b.s
}

func (si *secIndex) lowerBound(e secEntry) int {
	return sort.Search(len(si.entries), func(i int) bool {
		return !si.less(si.entries[i], e)
	})
}

// upperBoundValue returns the first index whose value is strictly greater than
// the probe's value — i.e. one past the last entry with that value.
func (si *secIndex) upperBoundValue(e secEntry) int {
	return sort.Search(len(si.entries), func(i int) bool {
		return si.valueGreater(si.entries[i], e)
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

// removePKs drops, in a single O(len) pass, every entry whose primary key is in
// pks — the bulk counterpart to remove, used by a range delete so retracting m
// keys costs one sweep instead of m binary-search-and-shift removals. Filtering
// in place preserves the (value, pk) sort order.
func (si *secIndex) removePKs(pks map[string]struct{}) {
	out := si.entries[:0]
	for _, e := range si.entries {
		if _, gone := pks[e.pk]; !gone {
			out = append(out, e)
		}
	}
	si.entries = out
}

// exact returns the primary keys whose index value equals val (multi-value).
// limit controls how many and in which direction:
//   - limit == 0: all matches, ascending by primary key.
//   - limit > 0:  the first `limit` matches, ascending.
//   - limit < 0:  the last `|limit|` matches, descending (newest-first when the
//     primary key encodes order).
func (si *secIndex) exact(val any, limit int) ([]string, error) {
	probe, err := si.makeEntry(val, "")
	if err != nil {
		return nil, err
	}
	lo := si.lowerBound(probe)      // first entry with value == val
	hi := si.upperBoundValue(probe) // one past the last entry with value == val
	if lo >= hi {
		return nil, nil
	}

	if limit < 0 {
		start := hi + limit // limit is negative
		if start < lo {
			start = lo
		}
		out := make([]string, 0, hi-start)
		for i := hi - 1; i >= start; i-- { // descending
			out = append(out, si.entries[i].pk)
		}
		return out, nil
	}

	end := hi
	if limit > 0 && lo+limit < hi {
		end = lo + limit
	}
	out := make([]string, 0, end-lo)
	for i := lo; i < end; i++ { // ascending
		out = append(out, si.entries[i].pk)
	}
	return out, nil
}

// exists reports whether any entry has index value == val, without collecting
// the matching primary keys — the cheap (O(log n), allocation-free) counterpart
// of exact for a presence check.
func (si *secIndex) exists(val any) (bool, error) {
	probe, err := si.makeEntry(val, "")
	if err != nil {
		return false, err
	}
	return si.lowerBound(probe) < si.upperBoundValue(probe), nil
}

// prefixUpperBound returns the smallest string strictly greater than every
// string that begins with p — the exclusive end of p's prefix range. It clones
// p, increments the last byte that isn't 0xFF, and drops everything after it
// (e.g. "Get" -> "Geu"). ok is false when no such bound exists — p is empty, or
// every byte is 0xFF — meaning the prefix range has no upper limit and runs to
// the end of the index.
func prefixUpperBound(p string) (string, bool) {
	b := []byte(p)
	for i := len(b) - 1; i >= 0; i-- {
		if b[i] != 0xFF {
			b[i]++
			return string(b[:i+1]), true
		}
	}
	return "", false
}

// groupEnd returns the first index in [i, hi) whose value differs from the
// value at i. Because entries are sorted by value, a single value's rows are
// contiguous, so its end is found with a binary search over the window instead
// of a linear walk — an O(log group) boundary jump.
func (si *secIndex) groupEnd(i, hi int) int {
	v := si.entries[i].s
	return i + sort.Search(hi-i, func(k int) bool {
		return si.entries[i+k].s > v
	})
}

// prefix returns the primary keys whose (string) index value starts with p.
//
// limit is applied per distinct index value (grouped), not to the flattened
// match list — a prefix can span several values, and the limit selects within
// each one:
//   - limit == 0: all matches, flat, in (value, primary key) order.
//   - limit > 0:  the first `limit` primary keys of each value, ascending.
//   - limit < 0:  the last `|limit|` of each value, descending (newest-first
//     when the primary key encodes order), matching exact's direction.
//
// The match window [lo, hi) is located with two binary searches rather than a
// linear prefix scan: entries are sorted by (value, pk), so every value that
// starts with p occupies one contiguous run. lo is the first entry >= p; hi is
// the first entry >= p's upper bound (the first value that no longer starts with
// p). Combined with the O(log group) boundary jumps below, a query that matches
// few groups stays cheap even over a huge index — total O(log n + g·log m + out)
// rather than O(log n + m).
func (si *secIndex) prefix(p string, limit int) ([]string, error) {
	if si.kind != KindString {
		return nil, fmt.Errorf("nteedb: prefix query requires a string index, %q is %s", si.name, si.kind)
	}
	lo := si.lowerBound(secEntry{s: p})
	hi := len(si.entries)
	if succ, ok := prefixUpperBound(p); ok {
		hi = si.lowerBound(secEntry{s: succ})
	}

	if limit == 0 {
		out := make([]string, 0, hi-lo)
		for i := lo; i < hi; i++ {
			out = append(out, si.entries[i].pk)
		}
		return out, nil
	}

	var out []string
	for i := lo; i < hi; {
		// [i, j) is the contiguous run of entries sharing one value.
		j := si.groupEnd(i, hi)
		if limit > 0 {
			end := i + limit
			if end > j {
				end = j
			}
			for k := i; k < end; k++ {
				out = append(out, si.entries[k].pk)
			}
		} else { // limit < 0: last |limit| of the group, descending
			start := j + limit // limit is negative
			if start < i {
				start = i
			}
			for k := j - 1; k >= start; k-- {
				out = append(out, si.entries[k].pk)
			}
		}
		i = j
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
	if err := db.appendRecordLocked(key, value, ix, db.opts.SyncEveryWrite); err != nil {
		return err
	}
	if err := db.enforceMaxPerValueLocked(ix); err != nil {
		return err
	}
	db.writes++
	db.maybeWriteHintLocked()
	return nil
}

// appendRecordLocked is the per-record write core shared by Put and PutBatch:
// blob offload, main-log append, and primary/secondary index updates. durable
// controls the per-write fsyncs — batch writers pass false and issue a single
// flush at the end of the batch. Callers must hold db.mu and have validated ix
// via buildIndexValues.
func (db *DB) appendRecordLocked(key string, value []byte, ix map[string]any, durable bool) error {
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
		if durable {
			if err := db.blobs.flush(); err != nil {
				return err
			}
		}
		rec = record{Key: key, Blob: &ref, IX: ix}
	}

	off, n, err := db.main.appendSync(rec, durable)
	if err != nil {
		return err
	}
	db.pk.upsert(pkEntry{key: key, off: off, n: n})
	db.refreshSecLocked(key, ix)
	return nil
}

// enforceMaxPerValueLocked applies each capped index's MaxPerValue to the value
// groups this write just touched: while a group holds more than max records,
// the lowest-pk (oldest, when keys encode time) records are evicted as full,
// durable deletes — tombstone first, then primary-index removal and retraction
// from every secondary index, exactly like Delete. Callers must hold db.mu.
//
// An overwrite of an existing key never grows a group (its old entry is
// retracted before the new one is inserted), so it cannot trigger eviction.
func (db *DB) enforceMaxPerValueLocked(ix map[string]any) error {
	for name, val := range ix {
		si := db.secIndexes[name]
		if si == nil || si.max <= 0 {
			continue
		}
		probe, err := si.makeEntry(val, "")
		if err != nil {
			continue // value already validated on write; be lenient here
		}
		lo := si.lowerBound(probe)
		hi := si.upperBoundValue(probe)
		excess := (hi - lo) - si.max
		if excess <= 0 {
			continue
		}
		// Snapshot the victim pks (the group's lowest) before retraction below
		// mutates the entries slice we are reading.
		victims := make([]string, 0, excess)
		for i := lo; i < lo+excess; i++ {
			victims = append(victims, si.entries[i].pk)
		}
		for _, pk := range victims {
			if _, _, err := db.main.append(record{Key: pk, Deleted: true}); err != nil {
				return err
			}
			db.pk.remove(pk)
			db.retractSecLocked(pk)
			db.writes++
		}
	}
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
//
// Invariant: the ix map stored into db.pkSec is owned by it from here on and is
// never mutated in place (every writer allocates a fresh map and replaces
// wholesale). The background hint writer relies on this to snapshot pkSec with
// a shallow copy of the outer map only.
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
// (multi-value). An optional limit controls count and direction: 0 (or omitted)
// = all ascending; N>0 = first N ascending; N<0 = last |N| descending.
func (db *DB) ByIndex(name string, val any, limit ...int) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return nil, fmt.Errorf("nteedb: unknown index %q", name)
	}
	n := 0
	if len(limit) > 0 {
		n = limit[0]
	}
	return si.exact(val, n)
}

// ByIndexHas reports whether any record has value val in the named index,
// without materializing the matching keys — the secondary-index counterpart of
// Has. An unknown index name (or a value of the wrong kind) is an error.
func (db *DB) ByIndexHas(name string, val any) (bool, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return false, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return false, fmt.Errorf("nteedb: unknown index %q", name)
	}
	return si.exists(val)
}

// ByIndexPrefix returns the primary keys whose value in the named (string) index
// starts with prefix. An optional limit is applied per distinct index value
// (grouped): 0 (or omitted) = all matches flat; N>0 = first N of each value
// ascending; N<0 = last |N| of each value descending.
func (db *DB) ByIndexPrefix(name, prefix string, limit ...int) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	si := db.secIndexes[name]
	if si == nil {
		return nil, fmt.Errorf("nteedb: unknown index %q", name)
	}
	n := 0
	if len(limit) > 0 {
		n = limit[0]
	}
	return si.prefix(prefix, n)
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
