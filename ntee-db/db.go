// Package nteedb is a pure-Go, dependency-free embedded key-value store.
//
// It is log-structured (Bitcask-style): an append-only JSONL "main table" is
// the source of truth, and an in-memory index maps each key to the byte offset
// of its latest record in that file. The data log doubles as the write-ahead
// log, so there is no separate WAL — the index is always rebuildable from the
// log and can never drift out of sync with the data.
//
// It supports exact lookups and prefix scans (no substring/fuzzy search). Only
// the index (keys + offsets) is resident in memory; record bodies and large
// values stay on disk and are read on demand.
package nteedb

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// DefaultBlobThreshold is the value size at or above which a value is stored in
// the blob side file instead of inline in the main log.
//
// This is a disk-layout/compaction knob, NOT a memory knob: values are never
// held in memory regardless (only the index is; values are read on demand). The
// default is deliberately generous so that typical request/response bodies stay
// inline, where Compact reclaims their dead versions — blobs.dat is append-only
// and not yet compacted, so moderate, frequently-overwritten values are better
// kept inline. Reserve blobs for genuinely large payloads where avoiding a
// recopy on every compaction matters.
const DefaultBlobThreshold = 64 << 10 // 64 KiB

const (
	mainFile = "main.jsonl"
	hintFile = "main.jsonl.hint"
)

// Options configures a DB.
type Options struct {
	// Dir is the directory holding the store's files. Required.
	Dir string

	// BlobThreshold is the value size (in bytes) at or above which a value is
	// written to the blob side file rather than inline in main.jsonl. A value
	// of 0 selects DefaultBlobThreshold; a negative value disables blobs (all
	// values stored inline).
	BlobThreshold int

	// SyncEveryWrite fsyncs the main log on every write (durable but slower).
	// When false, durability follows the OS flush schedule and a crash may lose
	// the most recent writes.
	SyncEveryWrite bool

	// HintEveryN rewrites the index hint file after this many writes (in
	// addition to on Close and after compaction). A value of 0 disables
	// periodic hint rewrites; the hint is still written on Close.
	HintEveryN int

	// Indexes declares the secondary indexes to maintain. They are rebuilt at
	// Open from the index values persisted in each record, so the same set
	// should be declared on every Open of a store.
	Indexes []IndexDef
}

// ErrClosed is returned when operating on a closed DB.
var ErrClosed = errors.New("nteedb: database is closed")

// DB is an open store. It is safe for concurrent use.
type DB struct {
	opts     Options
	mainPath string
	hintPath string
	blobPath string

	mu     sync.RWMutex
	log    *appendLog // append writer for main.jsonl
	rf     *os.File   // read handle for main.jsonl (ReadAt is concurrency-safe)
	blobs  *blobStore // large-value side file
	index  *index
	writes int // writes since the last hint rewrite
	closed bool

	// Secondary indexes (declared via Options.Indexes).
	indexDefs  []IndexDef
	secIndexes map[string]*secIndex      // name -> index
	pkSec      map[string]map[string]any // primary key -> its current index values (for retraction)
}

// Open opens (creating if necessary) the store in opts.Dir.
func Open(opts Options) (*DB, error) {
	if opts.Dir == "" {
		return nil, errors.New("nteedb: Options.Dir is required")
	}
	if opts.BlobThreshold == 0 {
		opts.BlobThreshold = DefaultBlobThreshold
	}
	if err := os.MkdirAll(opts.Dir, 0o755); err != nil {
		return nil, err
	}

	db := &DB{
		opts:       opts,
		mainPath:   filepath.Join(opts.Dir, mainFile),
		hintPath:   filepath.Join(opts.Dir, hintFile),
		blobPath:   filepath.Join(opts.Dir, blobFile),
		index:      newIndex(),
		indexDefs:  opts.Indexes,
		secIndexes: make(map[string]*secIndex, len(opts.Indexes)),
		pkSec:      make(map[string]map[string]any),
	}
	for _, def := range opts.Indexes {
		if def.Name == "" {
			return nil, errors.New("nteedb: secondary index name is required")
		}
		if _, dup := db.secIndexes[def.Name]; dup {
			return nil, fmt.Errorf("nteedb: duplicate index name %q", def.Name)
		}
		db.secIndexes[def.Name] = newSecIndex(def)
	}

	// Rebuild the index: load the hint (if any) and replay only the log tail
	// past its watermark; otherwise full-scan. Either way, self-heal a torn tail.
	if err := db.load(); err != nil {
		return nil, err
	}

	lg, err := openLog(db.mainPath, opts.SyncEveryWrite)
	if err != nil {
		return nil, err
	}
	rf, err := os.Open(db.mainPath)
	if err != nil {
		_ = lg.close()
		return nil, err
	}
	blobs, err := openBlobs(db.blobPath)
	if err != nil {
		_ = lg.close()
		_ = rf.Close()
		return nil, err
	}
	db.log = lg
	db.rf = rf
	db.blobs = blobs
	return db, nil
}

// load rebuilds the in-memory index. It uses the hint file as a fast path —
// loading its (sorted) entries and replaying only the log tail past the hint's
// watermark — and falls back to a full scan if the hint is missing, corrupt, or
// claims to cover more than the log actually contains.
func (db *DB) load() error {
	from := int64(0)
	if entries, covers, ok := loadHint(db.hintPath); ok {
		if info, err := os.Stat(db.mainPath); err == nil && covers <= info.Size() {
			// Rebuild both the primary index and the secondary indexes from the
			// hint snapshot (entries are already sorted by key).
			db.index.entries = db.index.entries[:0]
			for _, he := range entries {
				db.index.entries = append(db.index.entries, idxEntry{key: he.Key, off: he.Off, n: he.N})
				if len(he.IX) > 0 {
					db.refreshSecLocked(he.Key, he.IX)
				}
			}
			from = covers
		}
		// Otherwise the hint is stale/ahead of the log: ignore it and full-scan.
	}
	return db.replayTail(from)
}

// replayTail scans the main log from byte offset `from`, applying each record to
// the index, then truncates any torn final line left by a crash mid-append.
func (db *DB) replayTail(from int64) error {
	end, err := scanLog(db.mainPath, from, func(r record, off int64, n int32) error {
		if r.isTombstone() {
			db.index.remove(r.Key)
			db.retractSecLocked(r.Key)
		} else {
			db.index.upsert(idxEntry{key: r.Key, off: off, n: n})
			db.refreshSecLocked(r.Key, r.IX)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if info, statErr := os.Stat(db.mainPath); statErr == nil && end < info.Size() {
		if err := os.Truncate(db.mainPath, end); err != nil {
			return err
		}
	}
	return nil
}

// writeHintLocked flushes the log so the watermark reflects durable data, then
// atomically rewrites the hint. Callers must hold db.mu.
func (db *DB) writeHintLocked() error {
	// Flush blobs first: a main record may reference a blob, so the blob must be
	// durable before the watermark declares that record covered.
	if db.blobs != nil {
		if err := db.blobs.flush(); err != nil {
			return err
		}
	}
	if err := db.log.flush(); err != nil {
		return err
	}
	if err := writeHint(db.hintPath, db.index, db.pkSec, db.log.size); err != nil {
		return err
	}
	db.writes = 0
	return nil
}

// maybeWriteHintLocked rewrites the hint once HintEveryN writes have
// accumulated. It is best-effort: a failure is ignored because the data is
// already durable in the log and a stale hint only costs a slower next boot.
func (db *DB) maybeWriteHintLocked() {
	if db.opts.HintEveryN > 0 && db.writes >= db.opts.HintEveryN {
		_ = db.writeHintLocked()
	}
}

// Put stores value under key. Any secondary indexes with an Extract function
// derive their value from the record automatically.
func (db *DB) Put(key string, value []byte) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	return db.writeLocked(key, value, nil)
}

// PutIndexed stores value under key with explicit secondary index values (e.g.
// {"traceId": "abc", "status": 200}). Explicit values take precedence over any
// index Extract function. An unknown index name or a value of the wrong kind is
// an error and nothing is written.
func (db *DB) PutIndexed(key string, value []byte, idx IndexValues) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	return db.writeLocked(key, value, idx)
}

// Get returns the value stored under key. ok is false if the key is absent.
func (db *DB) Get(key string) (value []byte, ok bool, err error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, false, ErrClosed
	}
	e, ok := db.index.get(key)
	if !ok {
		return nil, false, nil
	}
	rec, err := db.readRecord(e)
	if err != nil {
		return nil, false, err
	}
	if rec.Blob != nil {
		v, err := db.blobs.readAt(*rec.Blob)
		if err != nil {
			return nil, false, err
		}
		return v, true, nil
	}
	return rec.Value, true, nil
}

// useBlobFor reports whether a value of the given size should be stored in the
// blob side file rather than inline. A non-positive BlobThreshold disables blobs.
func (db *DB) useBlobFor(size int) bool {
	return db.opts.BlobThreshold > 0 && size >= db.opts.BlobThreshold
}

// Has reports whether key is present without reading its value.
func (db *DB) Has(key string) bool {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return false
	}
	_, ok := db.index.get(key)
	return ok
}

// Delete removes key. Deleting an absent key is a no-op.
func (db *DB) Delete(key string) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return ErrClosed
	}
	if _, ok := db.index.get(key); !ok {
		return nil
	}
	if _, _, err := db.log.append(record{Key: key, Deleted: true}); err != nil {
		return err
	}
	db.index.remove(key)
	db.retractSecLocked(key)
	db.writes++
	db.maybeWriteHintLocked()
	return nil
}

// PrefixScan returns, in sorted order, every key beginning with prefix. An empty
// prefix returns all keys.
func (db *DB) PrefixScan(prefix string) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, ErrClosed
	}
	es := db.index.prefix(prefix)
	keys := make([]string, len(es))
	for i, e := range es {
		keys[i] = e.key
	}
	return keys, nil
}

// readRecord reads and decodes the record located by e from the main log.
func (db *DB) readRecord(e idxEntry) (record, error) {
	buf := make([]byte, e.n)
	if _, err := db.rf.ReadAt(buf, e.off); err != nil {
		return record{}, err
	}
	return unmarshalRecord(bytes.TrimSuffix(buf, []byte{'\n'}))
}

// Close flushes pending state and releases resources. The DB must not be used
// afterward.
func (db *DB) Close() error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return nil
	}
	db.closed = true

	var err error
	if db.log != nil {
		// Write a final hint so the next boot is fast (this also flushes the log).
		if e := db.writeHintLocked(); e != nil {
			err = e
		}
		if e := db.log.close(); e != nil && err == nil {
			err = e
		}
	}
	if db.rf != nil {
		if e := db.rf.Close(); e != nil && err == nil {
			err = e
		}
	}
	if db.blobs != nil {
		if e := db.blobs.close(); e != nil && err == nil {
			err = e
		}
	}
	return err
}
