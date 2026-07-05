package nteedb

import (
	"sort"
	"strings"
)

// pkEntry locates a key's latest record within the main log.
type pkEntry struct {
	key string
	off int64
	n   int32
}

// pkIndex is the in-memory primary-key index: a slice of entries kept sorted by
// key. A sorted slice serves both exact lookups and prefix scans in O(log n) via
// sort.Search; a hash map is avoided because a prefix scan on a hash map would
// require a full O(n) scan over every key.
//
// Scaling note: upsert of a NON-append key and remove both memmove the tail —
// O(n) per write. That is fine for this store's design point (time-ordered
// ascending keys, maxPerValue-capped sizes: appends move nothing) but is the
// known cliff at 50k+ records with random keys. The contemplated upgrade is an
// order-preserving btree, which keeps the O(log n) range/prefix walks while
// making insert/delete O(log n); see BenchmarkPutIndexedHotValue for the guard.
type pkIndex struct {
	entries []pkEntry
}

func newPkIndex() *pkIndex {
	return &pkIndex{}
}

func (ix *pkIndex) len() int { return len(ix.entries) }

// lowerBound returns the smallest i such that entries[i].key >= key (or len if
// none), via binary search.
func (ix *pkIndex) lowerBound(key string) int {
	return sort.Search(len(ix.entries), func(i int) bool {
		return ix.entries[i].key >= key
	})
}

// upperBound returns the smallest i such that entries[i].key > key (or len if
// none), via binary search.
func (ix *pkIndex) upperBound(key string) int {
	return sort.Search(len(ix.entries), func(i int) bool {
		return ix.entries[i].key > key
	})
}

// get returns the entry for an exact key.
func (ix *pkIndex) get(key string) (pkEntry, bool) {
	i := ix.lowerBound(key)
	if i < len(ix.entries) && ix.entries[i].key == key {
		return ix.entries[i], true
	}
	return pkEntry{}, false
}

// upsert inserts e, or updates the location of an existing key in place,
// keeping the slice sorted.
func (ix *pkIndex) upsert(e pkEntry) {
	i := ix.lowerBound(e.key)
	if i < len(ix.entries) && ix.entries[i].key == e.key {
		ix.entries[i] = e
		return
	}
	ix.entries = append(ix.entries, pkEntry{})
	copy(ix.entries[i+1:], ix.entries[i:])
	ix.entries[i] = e
}

// remove deletes a key, reporting whether it was present.
func (ix *pkIndex) remove(key string) bool {
	i := ix.lowerBound(key)
	if i < len(ix.entries) && ix.entries[i].key == key {
		ix.entries = append(ix.entries[:i], ix.entries[i+1:]...)
		return true
	}
	return false
}

// prefix returns all entries whose key starts with p, in sorted order. An empty
// prefix matches every entry.
func (ix *pkIndex) prefix(p string) []pkEntry {
	i := ix.lowerBound(p)
	var out []pkEntry
	for ; i < len(ix.entries) && strings.HasPrefix(ix.entries[i].key, p); i++ {
		out = append(out, ix.entries[i])
	}
	return out
}
