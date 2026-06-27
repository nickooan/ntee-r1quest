package nteedb

import (
	"fmt"
	"testing"
)

func benchSeed(b *testing.B, n int) (dir string, db *DB) {
	b.Helper()
	dir = b.TempDir()
	db, err := Open(Options{Dir: dir})
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < n; i++ {
		if err := db.Put(fmt.Sprintf("key%07d", i), []byte("value")); err != nil {
			b.Fatal(err)
		}
	}
	return dir, db
}

func BenchmarkPut(b *testing.B) {
	db, err := Open(Options{Dir: b.TempDir()})
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = db.Put(fmt.Sprintf("key%07d", i), []byte("value"))
	}
}

func BenchmarkGet(b *testing.B) {
	_, db := benchSeed(b, 10000)
	defer db.Close()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, _ = db.Get(fmt.Sprintf("key%07d", i%10000))
	}
}

func BenchmarkPrefixScan(b *testing.B) {
	_, db := benchSeed(b, 10000)
	defer db.Close()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = db.PrefixScan("key000001") // ~10 matching keys
	}
}

// BenchmarkBoot measures reopen time (hint load + tail replay) at scale.
func BenchmarkBoot(b *testing.B) {
	for _, n := range []int{1000, 10000, 100000} {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			dir, db := benchSeed(b, n)
			db.Close() // writes a full hint
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				d, err := Open(Options{Dir: dir})
				if err != nil {
					b.Fatal(err)
				}
				d.Close()
			}
		})
	}
}
