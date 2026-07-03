package nteedb

import "fmt"

// PutItem is one record in a PutBatch call.
type PutItem struct {
	Key   string
	Value []byte
	IX    IndexValues // optional explicit secondary-index values
}

// PutBatch applies items in array order under a single lock acquisition — the
// bulk counterpart to Put/PutIndexed for imports and other high-volume writes.
// It amortizes the per-write costs: one lock, unsynced appends with a single
// fsync at the end in durable mode, one MaxPerValue enforcement pass over the
// touched index values, and one hint trigger.
//
// Failure semantics: every item's index values are validated up front, so an
// invalid item fails the whole batch with nothing written. A mid-batch I/O
// error (e.g. disk full) leaves the items before it applied — the same outcome
// as issuing sequential Puts. When PutBatch returns nil, every record has been
// appended (and fsynced, in durable mode).
func (db *DB) PutBatch(items []PutItem) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	if len(items) == 0 {
		return nil
	}

	// Pass 1 — validate everything before writing anything.
	ixs := make([]map[string]any, len(items))
	for i, it := range items {
		ix, err := db.buildIndexValues(it.Key, it.Value, it.IX)
		if err != nil {
			return fmt.Errorf("nteedb: batch item %d (%q): %w", i, it.Key, err)
		}
		ixs[i] = ix
	}

	// Pass 2 — append in order, without per-write fsyncs.
	for i, it := range items {
		if err := db.appendRecordLocked(it.Key, it.Value, ixs[i], false); err != nil {
			return fmt.Errorf("nteedb: batch item %d (%q): %w", i, it.Key, err)
		}
	}

	// Enforce MaxPerValue once per distinct touched (index, value) pair. The
	// final state matches per-item enforcement — the cap keeps a group's
	// highest primary keys either way — with far fewer scans.
	seen := make(map[string]struct{})
	for _, ix := range ixs {
		for name, val := range ix {
			key := name + "\x00" + fmt.Sprint(val)
			if _, done := seen[key]; done {
				continue
			}
			seen[key] = struct{}{}
			if err := db.enforceMaxPerValueLocked(map[string]any{name: val}); err != nil {
				return err
			}
		}
	}

	// Durable mode: one flush for the whole batch, blobs before the main log so
	// the log never claims records whose blobs are not yet durable.
	if db.opts.SyncEveryWrite {
		if db.blobs != nil {
			if err := db.blobs.flush(); err != nil {
				return err
			}
		}
		if err := db.main.flush(); err != nil {
			return err
		}
	}

	db.writes += len(items)
	db.maybeWriteHintLocked()
	return nil
}
