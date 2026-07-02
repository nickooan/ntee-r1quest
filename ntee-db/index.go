package nteedb

import (
	"sort"
	"strings"
)

// idxEntry locates a key's latest record within the main log.
type idxEntry struct {
	key string
	off int64
	n   int32
}

// index is the in-memory primary index: a slice of entries kept sorted by key.
// A sorted slice serves both exact lookups and prefix scans in O(log n) via
// sort.Search; a hash map is avoided because a prefix scan on a hash map would
// require a full O(n) scan over every key.
type index struct {
	entries []idxEntry
}

func newIndex() *index {
	return &index{}
}

func (ix *index) len() int { return len(ix.entries) }

// lowerBound returns the smallest i such that entries[i].key >= key (or len if
// none), via binary search.
func (ix *index) lowerBound(key string) int {
	return sort.Search(len(ix.entries), func(i int) bool {
		return ix.entries[i].key >= key
	})
}

// upperBound returns the smallest i such that entries[i].key > key (or len if
// none), via binary search.
func (ix *index) upperBound(key string) int {
	return sort.Search(len(ix.entries), func(i int) bool {
		return ix.entries[i].key > key
	})
}

// get returns the entry for an exact key.
func (ix *index) get(key string) (idxEntry, bool) {
	i := ix.lowerBound(key)
	if i < len(ix.entries) && ix.entries[i].key == key {
		return ix.entries[i], true
	}
	return idxEntry{}, false
}

// upsert inserts e, or updates the location of an existing key in place,
// keeping the slice sorted.
func (ix *index) upsert(e idxEntry) {
	i := ix.lowerBound(e.key)
	if i < len(ix.entries) && ix.entries[i].key == e.key {
		ix.entries[i] = e
		return
	}
	ix.entries = append(ix.entries, idxEntry{})
	copy(ix.entries[i+1:], ix.entries[i:])
	ix.entries[i] = e
}

// remove deletes a key, reporting whether it was present.
func (ix *index) remove(key string) bool {
	i := ix.lowerBound(key)
	if i < len(ix.entries) && ix.entries[i].key == key {
		ix.entries = append(ix.entries[:i], ix.entries[i+1:]...)
		return true
	}
	return false
}

// prefix returns all entries whose key starts with p, in sorted order. An empty
// prefix matches every entry.
func (ix *index) prefix(p string) []idxEntry {
	i := ix.lowerBound(p)
	var out []idxEntry
	for ; i < len(ix.entries) && strings.HasPrefix(ix.entries[i].key, p); i++ {
		out = append(out, ix.entries[i])
	}
	return out
}
