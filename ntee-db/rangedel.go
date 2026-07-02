package nteedb

// Range deletes remove a contiguous span of primary keys in one pass. Keys are
// compared lexically (Go string order) over the whole key, so callers control
// what a range means via their key design (e.g. a zero-padded, time-ordered
// suffix makes "less than cutoff" mean "older than cutoff").
//
// Like Delete, each removed key gets a tombstone appended to the log, so the
// deletion is durable and crash-safe; the in-memory primary and secondary
// indexes are trimmed, and one hint rewrite snapshots the trimmed state. The
// on-disk log is not reclaimed here — that is Compact's job.

// RemoveByPkLess deletes every key strictly less than cutoff (the cutoff key
// itself is kept). It returns the number of keys removed.
func (db *DB) RemoveByPkLess(cutoff string) (int, error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return 0, ErrClosed
	}
	return db.removeIndexRangeLocked(0, db.index.lowerBound(cutoff))
}

// RemoveByPkGreater deletes every key strictly greater than cutoff (the cutoff
// key itself is kept). It returns the number of keys removed.
func (db *DB) RemoveByPkGreater(cutoff string) (int, error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return 0, ErrClosed
	}
	return db.removeIndexRangeLocked(db.index.upperBound(cutoff), db.index.len())
}

// removeIndexRangeLocked removes the primary-index entries in the half-open span
// [i, j), retracting their secondary entries and appending a tombstone per key.
// Callers must hold db.mu.
func (db *DB) removeIndexRangeLocked(i, j int) (int, error) {
	if i >= j {
		return 0, nil
	}

	// Snapshot the doomed keys before mutating anything: the index slice is
	// rewritten below, so we must not alias it.
	keys := make([]string, 0, j-i)
	for k := i; k < j; k++ {
		keys = append(keys, db.index.entries[k].key)
	}

	// Append all tombstones first, before any in-memory change. A mid-loop
	// append failure then leaves the in-memory indexes untouched, and the log
	// (the source of truth) still converges on the next replay — matching
	// Delete's append-then-mutate ordering.
	for _, key := range keys {
		if _, _, err := db.log.append(record{Key: key, Deleted: true}); err != nil {
			return 0, err
		}
	}

	// Retract secondary entries in one sweep per index, and drop each key's
	// reverse-map entry.
	doomed := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		doomed[key] = struct{}{}
		delete(db.pkSec, key)
	}
	for _, si := range db.secIndexes {
		si.removePKs(doomed)
	}

	// Remove the contiguous [i, j) span from the primary index in one splice.
	db.index.entries = append(db.index.entries[:i], db.index.entries[j:]...)

	// Force a hint rewrite so the trimmed state is the fast-boot snapshot and
	// covers advances past the tombstones we just appended.
	db.writes += len(keys)
	if err := db.writeHintLocked(); err != nil {
		return 0, err
	}
	return len(keys), nil
}
