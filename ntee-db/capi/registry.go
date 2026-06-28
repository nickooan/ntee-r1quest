package main

import (
	"sync"

	nteedb "codeberg.org/nickoan/ntee-r1quest/ntee-db"
)

// The handle registry maps opaque uint32 handles (held by the caller across the
// C/FFI boundary) to live *nteedb.DB instances. A Go pointer must never cross
// into C, so callers get an integer handle instead. uint32 maps cleanly to a JS
// number (no BigInt), and a 32-bit counter is far more than enough opens.
var (
	regMu    sync.Mutex
	regNext  uint32
	registry = map[uint32]*nteedb.DB{}
)

func regPut(db *nteedb.DB) uint32 {
	regMu.Lock()
	defer regMu.Unlock()
	regNext++
	registry[regNext] = db
	return regNext
}

func regGet(h uint32) *nteedb.DB {
	regMu.Lock()
	defer regMu.Unlock()
	return registry[h]
}

func regDelete(h uint32) *nteedb.DB {
	regMu.Lock()
	defer regMu.Unlock()
	db := registry[h]
	delete(registry, h)
	return db
}
