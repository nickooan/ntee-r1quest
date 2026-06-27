package nteedb

import (
	"bufio"
	"os"
)

// Compact rewrites the main log to contain only live records (one per key, with
// superseded versions and tombstones dropped), reclaiming space. The store is
// briefly read-only (the write lock is held) for the duration.
//
// Only the main log is rewritten; live records are copied verbatim so their
// blob references stay valid and blobs.dat is left untouched. This keeps the
// swap a single atomic rename — crash-safe — at the cost of not reclaiming dead
// space in blobs.dat (a separate, rarer operation left for the future).
func (db *DB) Compact() error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	return db.compactLocked()
}

func (db *DB) compactLocked() error {
	newMain := db.mainPath + ".compact"
	_ = os.Remove(newMain)

	newIdx, err := db.buildCompactedMain(newMain)
	if err != nil {
		_ = os.Remove(newMain)
		return err
	}

	// Swap: close old main handles, atomically replace the file, reopen.
	// (blobs.dat is unchanged, so db.blobs stays open as-is.)
	_ = db.log.close()
	_ = db.rf.Close()
	if err := os.Rename(newMain, db.mainPath); err != nil {
		return err
	}

	lg, err := openLog(db.mainPath, db.opts.SyncEveryWrite)
	if err != nil {
		return err
	}
	rf, err := os.Open(db.mainPath)
	if err != nil {
		_ = lg.close()
		return err
	}
	db.log = lg
	db.rf = rf
	db.index = newIdx
	db.writes = 0

	// Fresh hint covering the whole rewritten log.
	return db.writeHintLocked()
}

// buildCompactedMain writes a new main log at path containing only the current
// live records (in sorted key order), copying each record's bytes verbatim, and
// returns the index for the new file.
func (db *DB) buildCompactedMain(path string) (*index, error) {
	mf, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	w := bufio.NewWriter(mf)

	newIdx := newIndex()
	var off int64
	for _, e := range db.index.entries { // already sorted by key
		buf := make([]byte, e.n)
		if _, err := db.rf.ReadAt(buf, e.off); err != nil {
			_ = mf.Close()
			return nil, err
		}
		if _, err := w.Write(buf); err != nil {
			_ = mf.Close()
			return nil, err
		}
		// Keys are visited in sorted order, so a plain append keeps newIdx sorted.
		newIdx.entries = append(newIdx.entries, idxEntry{key: e.key, off: off, n: e.n})
		off += int64(e.n)
	}

	if err := w.Flush(); err != nil {
		_ = mf.Close()
		return nil, err
	}
	if err := mf.Sync(); err != nil {
		_ = mf.Close()
		return nil, err
	}
	return newIdx, mf.Close()
}
