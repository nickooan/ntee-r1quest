# ntee-db (`nteedb`)

A small, pure-Go (stdlib-only, no external dependencies) embedded key-value
store for local CLI/TUI apps. Log-structured (Bitcask-style): an append-only
JSONL file is the source of truth, with an in-memory index for fast lookups.

## Design

```
<dir>/main.jsonl        append-only data log — source of truth (one JSON record per line)
<dir>/blobs.dat         append-only large values, referenced by a blob ref in a main.jsonl line
<dir>/main.jsonl.hint   persisted index snapshot (JSONL): sorted key→{off,len} + a "covers" watermark
```

- **No separate WAL.** The data log *is* the write-ahead log: the index is always
  rebuildable from it and can never drift out of sync with the data.
- **In-memory index** is a single slice kept sorted by key. It serves both exact
  lookups and prefix scans in O(log n) via binary search. (A hash map is avoided
  because prefix scans on a hash map require a full O(n) scan.)
- **Hybrid memory.** Only the index (keys + offsets) is resident; record bodies
  and large values stay on disk and are read on demand. Values at or above
  `BlobThreshold` go to `blobs.dat` so the main log stays small.
- **Fast boot.** Startup loads the hint and replays only the log tail past its
  `covers` watermark; a missing/corrupt hint safely falls back to a full scan.
  A torn final line from a crash mid-append is detected and truncated.
- **Compaction** rewrites the main log with only live records (dropping
  superseded versions and tombstones) via a single atomic rename.

## Scope

Supports exact lookup and **prefix** search only — no substring/fuzzy search.
Secondary grouping is done by **namespacing keys** (e.g. `input:`, `api:`) and
prefix-scanning, which reuses the one index with no extra structure.

## Usage

```go
db, err := nteedb.Open(nteedb.Options{Dir: "/path/to/store"})
if err != nil { /* ... */ }
defer db.Close()

db.Put("input:GetOrders", []byte("..."))
v, ok, err := db.Get("input:GetOrders")
keys, err := db.PrefixScan("input:Get") // sorted keys with that prefix
db.Delete("input:GetOrders")
db.Compact()
```

### Options

| Field            | Meaning |
|------------------|---------|
| `Dir`            | Store directory (required). |
| `BlobThreshold`  | Values ≥ this many bytes go to `blobs.dat`. `0` → 8 KiB default; negative disables blobs. |
| `SyncEveryWrite` | fsync the log on every write (durable but slower). When false, a crash may lose the most recent writes. |
| `HintEveryN`     | Rewrite the hint after N writes (also on `Close` and after compaction). `0` disables periodic rewrites. |

## Testing

```sh
go test -race ./...
go test -bench . ./...
```
