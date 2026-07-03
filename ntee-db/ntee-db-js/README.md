# @ntee/ntee-db (Node.js binding)

In-process Node.js binding for **nteedb** — a pure-Go embedded log-structured
KV store with prefix search and secondary indexes. The Go core is exposed as a
C-shared library and loaded via [koffi](https://koffi.dev) (FFI). No separate
process; same model as `lmdb`/`better-sqlite3` (prebuilt native binaries per
platform).

## Performance

Microbenchmark vs `lmdb` (lmdb-js) from Node, on a cache-shaped workload:
20,000 records, ~120-byte JSON values, time-ordered keys
(`api:<zero-padded-id>`). Apple M2 Pro, Node 24; each figure is the mean of 5
rounds (fresh store per round, warm-up discarded). Scripts in
[`bench/`](bench/).

| Operation                    | @ntee/ntee-db | lmdb                       | Faster            |
| ---------------------------- | ------------- | -------------------------- | ----------------- |
| `get`                        | 6.2 µs/op     | 0.8 µs/op                  | lmdb ~8×          |
| exists check                 | 1.3 µs/op     | 0.6 µs/op                  | lmdb ~2×          |
| put (non-durable path)       | 4.7 µs/op     | 0.9 µs/op (async, batched) | lmdb ~5×          |
| `putMany` (one 20k batch)    | 5.2 µs/op     | 0.9 µs/op (async, batched) | lmdb ~6×          |
| **put (synchronous commit)** | **4.7 µs/op** | 2,827 µs/op (`putSync`)    | **ntee-db ~600×** |
| put (sync, `hintEveryN: 5`)  | ~19 µs/op     | —                          |                   |
| prefix scan, all 20k keys    | **3.7 ms**    | 5.8 ms (PK range scan)     | **ntee-db ~1.6×** |

`hintEveryN: 5` is the app's boot-optimization config; its periodic index
snapshots run in a background goroutine, so a put only pays a cheap in-memory
snapshot.

**Indexed workload** — the app's real shape: every write carries two secondary
index values (`endpoint`, `traceId`); 20k records across 500 distinct
endpoints. lmdb has no built-in secondary indexes, so its "latest per
endpoint" counterpart is what the pre-ntee-db app code did — full scan +
parse + dedup in JS:

| Operation                                   | @ntee/ntee-db         | lmdb                          | Faster            |
| ------------------------------------------- | --------------------- | ----------------------------- | ----------------- |
| put carrying 2 index values (sync)          | 16.8 µs/op            | 1.1 µs/op (async, no indexes) | lmdb\*            |
| put, full app config\*\*                    | 67 µs/op              | —                             |                   |
| latest call of one endpoint (`byIndex`, -1) | 2.4 µs/op             | —                             |                   |
| **latest call of every endpoint (500/20k)** | **0.1 ms** (one call) | 19.4 ms (scan + dedup)        | **ntee-db ~190×** |

\* not equivalent work: lmdb's put maintains no indexes — that cost lands on
every query instead (the 19.4 ms row).

\*\* the app's exact open options (2 indexes + `maxPerValue: 5` on `endpoint` +
`hintEveryN: 5`). The extra cost is real retention work: ~17.5k automatic
durable evictions holding every endpoint at its 5 newest records.

How to read this honestly:

- **Single-op reads: lmdb wins (~8×).** A memory-mapped B+tree read vs an FFI
  crossing + `pread` + JSON envelope. Both are microseconds — imperceptible
  for tens of ops per user interaction.
- **Synchronous writes: ntee-db wins (~600×).** The append-only log makes a
  caller-synchronous write a single ~5 µs append, so a CLI that exits right
  after a request still persists its record. lmdb's only caller-synchronous
  commit (`putSync`) pays a copy-on-write transaction per call; its fast path
  is async/batched — not synchronous to the caller.
- **Scans: ntee-db wins (~2×; ~190× once indexes matter).** Keys live in a
  RAM-resident sorted index, and grouped queries like "newest record per
  matching value" are one bounded native call.
- **`putMany`'s wins are structural, not per-op:** a bulk load runs off the JS
  thread entirely and costs one fsync instead of N in durable mode — while
  still resolving only when every record is appended.
- **Index maintenance costs writes ~4×** — the write pays once so every query
  stays bounded. Still synchronous and negligible at human pace.
- **Where lmdb fundamentally wins:** very large datasets (ntee-db keeps all
  keys in RAM and pays an O(n) boot scan — ~100 ms at 100k keys),
  multi-process access, and full ACID transactions.

### Why r1quest uses ntee-db

r1quest is a local app on the user's own device. At this scale **both engines
are "fast enough"** — the accurate summary is not "ntee-db is faster", it's:
_ntee-db is faster exactly where this app is sensitive, decent everywhere
else, and structurally immune to its own weaknesses at this scale._

- **Sync writes are the hot requirement.** One-shot CLI runs exit immediately
  after the request, so "on disk before the process exits" must be the
  _default_ write path — ~17 µs for the app's real indexed write.
- **Reads only need to be decent — and they are.** Rendering a 50-endpoint
  history costs ~0.3 ms; the read gap would only show at thousands of reads
  per frame, which a human-paced TUI never does.
- **The feature fit is the bigger argument.** Secondary indexes, grouped
  newest-per-value queries, `maxPerValue` retention, and range delete by
  time-ordered key are all used by the app — with lmdb each was (or would be)
  hand-rolled JS, and the History-list pattern measured 0.1 ms via the index
  vs 18.4 ms as a scan.
- **Its weaknesses are structurally avoided.** `maxPerValue` caps the store by
  construction and the hint keeps boots fast, so all-keys-in-RAM and the O(n)
  boot scan never bite; conversely lmdb's superpowers (huge datasets, ACID
  transactions) were dead weight for this workload.
- **Multi-process overlap is guarded.** `open` takes an exclusive kernel lock
  (`flock`); a second opener fails fast and the app degrades that process to a
  cache-less run. The lock is process-owned, so it releases on any exit —
  Ctrl+C, crash, `kill -9` — with no stale-lock state possible.

### Running the benchmarks

lmdb is a devDependency (never shipped to consumers), so `npm install` is all
the setup needed:

```sh
node bench/core.mjs      # main table
node bench/indexed.mjs   # indexed workload table
node bench/batch.mjs     # putMany row
```

## Usage

```js
import { NteeDB } from "@ntee/ntee-db"

const db = NteeDB.open("/path/to/store", {
  blobThreshold: 64 * 1024, // values >= this go to the blob side file
  indexes: [
    { name: "traceId", kind: "string" }, // explicit values
    { name: "kind", kind: "string", jsonPath: "kind" }, // auto-derived from JSON
  ],
})

// write (value is a Buffer or string; 3rd arg = explicit index values)
db.put("call:1", JSON.stringify({ kind: "request" }), { traceId: "T1" })

// read content back
const buf = db.get("call:1") // Buffer | null

// search → keys, then get; or searchByIndex → records in one call
db.byIndex("traceId", "T1") // ['call:1', ...]
db.searchByIndex("kind", "request") // [{ key, value: Buffer }, ...]
db.prefixScan("call:") // sorted keys
db.byIndexRange("status", 200, 299) // numeric range

// maintenance (off the event loop)
await db.compact() // reclaim dead records
await db.reindex() // back-fill jsonPath indexes over history; purge dropped

db.close() // or db.drop() to delete the store
```

## API

| Method                                   | Returns            | Notes                                                             |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `NteeDB.open(dir, opts?)`                | `NteeDB`           | creates if missing                                                |
| `NteeDB.destroy(dir)`                    | `void`             | delete a store's files (no open handle)                           |
| `put(key, value, ix?)`                   | `void`             | `value`: Buffer\|string; `ix`: `{name: string\|number}`           |
| `putMany(items)`                         | `Promise<number>`  | one batch off the event loop; in-order; all-or-nothing validation |
| `get(key)`                               | `Buffer \| null`   |                                                                   |
| `has(key)` / `delete(key)`               | `boolean` / `void` |                                                                   |
| `prefixScan(prefix)`                     | `string[]`         | sorted keys                                                       |
| `byIndex / byIndexPrefix / byIndexRange` | `string[]`         | primary keys                                                      |
| `searchByIndex / searchByPrefix`         | `{key, value}[]`   | keys + content                                                    |
| `droppedIndexes / prospectiveIndexes`    | `string[]`         | schema state                                                      |
| `compact()` / `reindex()`                | `Promise<void>`    | run off the event loop                                            |
| `close()` / `drop()`                     | `void`             |                                                                   |

## Notes / limitations

- **Index values from JS**: pass them explicitly via `put(..., ix)`, or declare a
  `jsonPath` so the value is derived from the record (the only form `reindex()`
  can back-fill). JS-function extractors are not supported.
- **Marshaling**: the API is Buffer/string in, Buffer out, byte-exact. On the
  wire and on disk, valid-UTF-8 values travel as plain JSON strings and only
  binary values as base64.
- Errors from the store surface as thrown `Error`s.

## Building the native lib

Prebuilt binaries live in `prebuilds/<os>-<arch>/`. To (re)build for the host:

```sh
npm run build:native      # runs ../capi/build.sh → prebuilds/<os>-<arch>/
npm test
```

Cross-OS binaries are produced by building **on each OS** (CI matrix); there is
no cross-compile step (the Go + cgo source is identical per platform). Linux
binaries can also be built from macOS with Docker via the repo's
`npm run build:db-linux` (platform-pinned containers; on Apple Silicon,
linux/amd64 runs under emulation).
