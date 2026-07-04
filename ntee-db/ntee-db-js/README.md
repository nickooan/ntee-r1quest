# @ntee/ntee-db (Node.js binding)

In-process Node.js binding for **nteedb** — a pure-Go embedded log-structured
KV store with prefix search and secondary indexes. The Go core is exposed as a
C-shared library and loaded via [koffi](https://koffi.dev) (FFI). No separate
process; same model as `lmdb`/`better-sqlite3` (prebuilt native binaries per
platform).

## Performance

Microbenchmark vs `lmdb` (lmdb-js) and `better-sqlite3` from Node, on a
cache-shaped workload: 20,000 records, ~120-byte JSON values, time-ordered keys
(`api:<zero-padded-id>`). Apple M2 Pro, Node 24; each figure is the mean of 5
rounds (fresh store per round, warm-up discarded). Scripts in
[`bench/`](bench/); **bold** marks the fastest engine per row.

| Operation                              | @ntee/ntee-db | lmdb              | better-sqlite3   |
| -------------------------------------- | ------------- | ----------------- | ---------------- |
| `get`                                  | 4.8 µs        | **1.1 µs**        | 1.5 µs           |
| exists check                           | 1.3 µs        | **0.7 µs**        | 1.6 µs           |
| put — fast path (caller-sync)          | **4.6 µs**    | 1.6 µs (async†)   | 10.9 µs          |
| put — fsync every write (power-loss)   | ~3 ms         | ~3 ms             | ~3 ms            |
| batch (one 20k commit)                 | 4.7 µs        | —                 | **2.5 µs** (txn) |
| put — fast, `hintEveryN: 5`            | 16.2 µs       | —                 | —                |
| prefix scan, all 20k keys              | **2.2 ms**    | 3.9 ms            | 4.8 ms           |

† lmdb's fast path is **async/batched** — the write is not durable when the
call returns, so it is not a caller-synchronous write like ntee-db's `put` or
SQLite's. It is listed for context, not as a like-for-like peer in that row.

**On the two write tiers.** A per-write, power-loss-durable commit is bounded
by the hardware `fsync`, so all three engines land at ~3 ms — the engine barely
matters. That is exactly why r1quest uses the **fast path** instead: an
append-only write that is durable the moment the call returns (survives a
process crash; a power loss can lose only writes from the last fraction of a
second). ntee-db's append is the fastest of the caller-synchronous fast writes.
The fsync row uses matched durability: SQLite runs `synchronous=FULL` +
`fullfsync=ON` (its default `FULL` on macOS is ~35 µs but uses a lighter
`fsync` that does not flush the drive cache); ntee-db uses `syncEveryWrite`;
lmdb uses `putSync`.

**Indexed workload** — the app's real shape: every write carries two secondary
index values (`endpoint`, `traceId`); 20k records across 500 distinct
endpoints. SQLite is a genuine peer here (it has real secondary indexes); lmdb
has none, so its "latest per endpoint" is what the pre-ntee-db app code did —
full scan + parse + dedup in JS.

| Operation                              | @ntee/ntee-db | lmdb                   | better-sqlite3   |
| -------------------------------------- | ------------- | ---------------------- | ---------------- |
| put carrying 2 index values            | **16.7 µs**   | 1.2 µs (no indexes\*)  | 25.2 µs          |
| put, full app config\*\*               | 68 µs         | —                      | —                |
| latest call of one endpoint            | 2.5 µs        | —                      | **1.5 µs**       |
| latest call of every endpoint (500)    | **0.1 ms**    | 17.8 ms (scan + dedup) | 1.5 ms (`GROUP BY`) |

\* not equivalent work: lmdb's put maintains no indexes — that cost lands on
every query instead (the 17.8 ms row). ntee-db and SQLite both maintain the two
indexes on write.

\*\* the app's exact open options (2 indexes + `maxPerValue: 5` on `endpoint` +
`hintEveryN: 5`): ~17.5k automatic durable evictions holding every endpoint at
its 5 newest records. Neither lmdb nor SQLite has native per-key retention (a
SQLite equivalent would need a trigger or periodic `DELETE`).

How to read this honestly:

- **Point reads: lmdb and SQLite both beat ntee-db (~3–4×).** ntee-db is the
  slowest reader — an FFI crossing + `pread` + JSON envelope vs a memory-mapped
  B+tree read or a prepared SQLite statement. All three are single-digit µs, so
  it is imperceptible for the tens of reads a user interaction makes.
- **Caller-synchronous writes: ntee-db is fastest (~2.4× vs SQLite).** Among
  writes that are durable-vs-crash the instant the call returns, the append-only
  log beats SQLite's B-tree page updates + WAL frame; lmdb's faster number is
  its async path, which is not caller-synchronous.
- **Power-loss-durable writes: a wash (~3 ms, all three).** `fsync` dominates,
  so this tier is not an engine differentiator — it is the reason r1quest keeps
  the fast append path as its default.
- **Batches: SQLite's transaction is fastest per-op, but blocks the JS thread.**
  ntee-db's `putMany` (4.7 µs/op) runs off the event loop and is one `fsync` in
  durable mode — a structural win (no thread stall, one sync for the whole
  load), not a per-op one.
- **Scans: ntee-db wins (~2×).** Keys live in a RAM-resident sorted index; a
  full-prefix scan is a bounded native traversal.
- **Grouped "newest per value": ntee-db wins even vs SQLite (~15×; ~180× vs
  lmdb).** `byIndexPrefix(name, prefix, -1)` returns one key per distinct value
  in a single cache-resident traversal, vs SQLite's `GROUP BY` over the index or
  lmdb's scan-and-dedup in JS. This is the app's History-list query.
- **Where the others fundamentally win:** SQLite brings SQL, transactions,
  multi-process access, and decades of durability hardening; lmdb brings the
  fastest reads and scales to datasets far past what ntee-db (all keys in RAM,
  O(n) boot scan — ~100 ms at 100k keys) is built for.

### Why r1quest uses ntee-db

r1quest is a local app on the user's own device. At this scale **all three
engines are "fast enough"** — the accurate summary is not "ntee-db is faster",
it's: _ntee-db is faster exactly where this app is sensitive (caller-sync
appends, sorted-key scans, grouped newest-per-value queries), decent everywhere
else, and ships retention + a readable log for free._ SQLite would be the pick
if the app needed general SQL, transactions, or multi-process; lmdb if it
needed raw read throughput or far larger datasets — none of which this workload
does.

- **Sync writes are the hot requirement.** One-shot CLI runs exit immediately
  after the request, so "on disk before the process exits" must be the
  _default_ write path — ~17 µs for the app's real indexed write.
- **Reads only need to be decent — and they are.** Rendering a 50-endpoint
  history costs ~0.2 ms; the ~3× read gap vs SQLite would only show at thousands
  of reads per frame, which a human-paced TUI never does.
- **The feature fit is the bigger argument.** Secondary indexes, grouped
  newest-per-value queries, `maxPerValue` retention, and range delete by
  time-ordered key are all used by the app. SQLite could express the queries in
  SQL but not the retention (that needs a trigger), and its grouped
  newest-per-value is ~15× slower; with lmdb each was hand-rolled JS. The
  History-list pattern measured 0.1 ms via the index vs 1.5 ms (SQLite) / 17.8
  ms (lmdb scan).
- **Its weaknesses are structurally avoided.** `maxPerValue` caps the store by
  construction and the hint keeps boots fast, so all-keys-in-RAM and the O(n)
  boot scan never bite; conversely SQLite's and lmdb's superpowers (SQL,
  transactions, multi-process, huge datasets) were dead weight for this
  workload.
- **Multi-process overlap is guarded.** `open` takes an exclusive kernel lock
  (`flock`); a second opener fails fast and the app degrades that process to a
  cache-less run. The lock is process-owned, so it releases on any exit —
  Ctrl+C, crash, `kill -9` — with no stale-lock state possible.

### Running the benchmarks

`lmdb` and `better-sqlite3` are devDependencies (never shipped to consumers), so
`npm install` is all the setup needed:

```sh
node bench/core.mjs      # main table (ntee-db · lmdb · sqlite)
node bench/indexed.mjs   # indexed workload table
node bench/batch.mjs     # putMany, ntee-db only
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
