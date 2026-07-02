package nteedb

import (
	"bufio"
	"os"
)

// Compact rewrites the main log to contain only live records (one per key, with
// superseded versions and tombstones dropped), reclaiming space. It is also
// schema-aware: each record's ix is filtered to the currently declared indexes,
// so fields of dropped indexes are swept away. No record values are read, so
// this is cheap. The store is briefly read-only (the write lock is held).
//
// Only the main log is rewritten; blob references are preserved and blobs.dat is
// left untouched, keeping the swap a single atomic rename (crash-safe).
func (db *DB) Compact() error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	return db.rewriteLocked(db.compactTransform)
}

// compactTransform keeps a record as-is except for filtering its ix down to the
// *known* indexes — active or soft-dropped (no value reads). Soft-dropped index
// data is deliberately preserved here; only Reindex purges it.
func (db *DB) compactTransform(rec record) (record, error) {
	rec.IX = db.filterIXKnown(rec.IX)
	return rec, nil
}

// filterIX returns the subset of ix whose names are currently *active* indexes
// (used by Reindex, which purges soft-dropped indexes).
func (db *DB) filterIX(ix map[string]any) map[string]any {
	if len(ix) == 0 {
		return nil
	}
	out := make(map[string]any, len(ix))
	for name, v := range ix {
		if _, ok := db.secIndexes[name]; ok {
			out[name] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// filterIXKnown returns the subset of ix whose names are known — active OR
// soft-dropped — stripping only truly-unknown names (used by Compact).
func (db *DB) filterIXKnown(ix map[string]any) map[string]any {
	if len(ix) == 0 {
		return nil
	}
	out := make(map[string]any, len(ix))
	for name, v := range ix {
		_, active := db.secIndexes[name]
		_, dropped := db.dropped[name]
		if active || dropped {
			out[name] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// rewriteLocked rewrites the main log keeping only live records, applying
// transform to each, then atomically swaps the file in and rebuilds in-memory
// state. Callers must hold db.mu. (blobs.dat is unchanged, so db.blobs stays
// open as-is.)
func (db *DB) rewriteLocked(transform func(record) (record, error)) error {
	newMain := db.mainPath + ".compact"
	_ = os.Remove(newMain)

	newIdx, newPkSec, err := db.buildRewrite(newMain, transform)
	if err != nil {
		_ = os.Remove(newMain)
		return err
	}

	// Swap: close old main handles, atomically replace the file, reopen.
	_ = db.main.close()
	_ = db.rf.Close()
	if err := os.Rename(newMain, db.mainPath); err != nil {
		return err
	}

	lg, err := openMainLog(db.mainPath, db.opts.SyncEveryWrite)
	if err != nil {
		return err
	}
	rf, err := os.Open(db.mainPath)
	if err != nil {
		_ = lg.close()
		return err
	}
	db.main = lg
	db.rf = rf
	db.pk = newIdx
	db.rebuildSecFromPkSec(newPkSec)
	db.writes = 0

	return db.writeHintLocked()
}

// buildRewrite writes a new main log at path containing only the current live
// records (in sorted key order), applying transform to each. It returns the new
// primary index and the final ix values per key (for rebuilding secondary state).
func (db *DB) buildRewrite(path string, transform func(record) (record, error)) (*pkIndex, map[string]map[string]any, error) {
	mf, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, nil, err
	}
	w := bufio.NewWriter(mf)

	newIdx := newPkIndex()
	newPkSec := make(map[string]map[string]any)
	var off int64
	for _, e := range db.pk.entries { // already sorted by key
		rec, err := db.readRecord(e)
		if err != nil {
			_ = mf.Close()
			return nil, nil, err
		}
		rec, err = transform(rec)
		if err != nil {
			_ = mf.Close()
			return nil, nil, err
		}
		line, err := marshalRecord(rec)
		if err != nil {
			_ = mf.Close()
			return nil, nil, err
		}
		line = append(line, '\n')
		if _, err := w.Write(line); err != nil {
			_ = mf.Close()
			return nil, nil, err
		}
		n := int32(len(line))
		newIdx.entries = append(newIdx.entries, pkEntry{key: e.key, off: off, n: n})
		if len(rec.IX) > 0 {
			newPkSec[e.key] = rec.IX
		}
		off += int64(n)
	}

	if err := w.Flush(); err != nil {
		_ = mf.Close()
		return nil, nil, err
	}
	if err := mf.Sync(); err != nil {
		_ = mf.Close()
		return nil, nil, err
	}
	return newIdx, newPkSec, mf.Close()
}
