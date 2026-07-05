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

| Operation                            | @ntee/ntee-db | lmdb            | better-sqlite3   |
| ------------------------------------ | ------------- | --------------- | ---------------- |
| `get`                                | 4.8 µs        | **1.1 µs**      | 1.5 µs           |
| exists check                         | 1.3 µs        | **0.7 µs**      | 1.6 µs           |
| put — fast path (caller-sync)        | **4.6 µs**    | 1.6 µs (async†) | 10.9 µs          |
| put — fsync every write (power-loss) | ~3 ms         | ~3 ms           | ~3 ms            |
| batch (one 20k commit)               | 4.7 µs        | —               | **2.5 µs** (txn) |
| put — fast, `hintEveryN: 5`          | 16.2 µs       | —               | —                |
| prefix scan, all 20k keys            | **2.2 ms**    | 3.9 ms          | 4.8 ms           |

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

| Operation                           | @ntee/ntee-db | lmdb                   | better-sqlite3      |
| ----------------------------------- | ------------- | ---------------------- | ------------------- |
| put carrying 2 index values         | **16.7 µs**   | 1.2 µs (no indexes\*)  | 25.2 µs             |
| put, full app config\*\*            | 68 µs         | —                      | —                   |
| search a value → keys (~20 matches) | 3.5 µs        | —§                     | **2.9 µs**          |
| search a value → records (~20)      | ~85 µs        | —§                     | **11 µs**           |
| latest call of one endpoint         | 2.5 µs        | —                      | **1.5 µs**          |
| latest call of every endpoint (500) | **0.1 ms**    | 17.8 ms (scan + dedup) | 1.5 ms (`GROUP BY`) |

\* not equivalent work: lmdb's put maintains no indexes — that cost lands on
every query instead (the 17.8 ms row). ntee-db and SQLite both maintain the two
indexes on write.

§ lmdb has no secondary index — an equality search is a full scan + filter
(≈ the 17.8 ms scan) per value.

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
  lmdb).** `secIndexPrefix(name, prefix, -1)` returns one key per distinct value
  in a single cache-resident traversal, vs SQLite's `GROUP BY` over the index or
  lmdb's scan-and-dedup in JS. This is the app's History-list query.
- **Record-returning index search is ntee-db's soft spot (~7× vs SQLite).**
  Looking up an index value's _keys_ is competitive (3–5 µs), but fetching the
  values adds the cost. `secIndexRecords` now uses a batched native `getMany`
  (one crossing, not N+1 — down from ~116 µs) and returns parsed objects
  directly, so it's ~85 µs for a 20-match value vs SQLite's 11 µs. The residual
  gap is **not** crossing count anymore —
  it's the koffi string boundary itself (Go marshals one JSON document, JS
  parses it), which only a native N-API addon would remove. Still sub-ms for the
  app's ~50-record renders.
- **Where the others fundamentally win:** SQLite brings SQL, transactions,
  multi-process access, and decades of durability hardening; lmdb brings the
  fastest reads and scales to datasets far past what ntee-db (all keys in RAM,
  O(n) boot scan — ~100 ms at 100k keys) is built for.

### Why r1quest uses ntee-db

It's a local, single-user app, so all three engines are "fast enough" — what
matters is _fit_. Every operation r1quest leans on is a row ntee-db wins in the
tables above:

| the app needs…                                    | ntee-db  | vs the field                                 |
| ------------------------------------------------- | -------- | -------------------------------------------- |
| persist before a one-shot CLI exits (sync write)  | ~17 µs   | ~2.4× faster than SQLite's caller-sync write |
| the History list — latest call per endpoint       | 0.1 ms   | ~15× SQLite `GROUP BY`, ~180× an lmdb scan   |
| a cache that can't grow (`maxPerValue` retention) | built-in | no native equivalent in SQLite or lmdb       |

Point reads are ~3× behind SQLite but sub-ms and rare per interaction. SQLite
would win if the app needed SQL, transactions, or multi-process; lmdb for raw
reads or far larger datasets — none of which a local request cache does. The one
real multi-process case (a TUI session overlapping a one-shot run) is guarded by
a single-writer `flock`: the second opener fails fast and degrades to a
cache-less run, and the lock releases on any exit (Ctrl+C, crash, `kill -9`).

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

// write — an object is JSON-serialized for you (3rd arg = explicit index values)
db.put("call:1", { kind: "request" }, { traceId: "T1" })

// read content back — ntee-db is a JSON store, so reads return the parsed value
const rec = db.get("call:1") // { kind: "request" } | null
db.getMany(["call:1", "call:2"]) // values aligned to keys, in one call

// search → keys, then get; or secIndexRecords → records in one call
db.secIndex("traceId", "T1") // ['call:1', ...]
db.secIndexRecords("kind", "request") // [{ key, value }, ...]
db.prefixScan("call:") // sorted keys
db.secIndexRange("status", 200, 299) // numeric range

// maintenance (off the event loop)
await db.compact() // reclaim dead records
await db.reindex() // back-fill jsonPath indexes over history; purge dropped

db.close() // or db.drop() to delete the store
```

### Values are JSON

ntee-db is a JSON store: reads return the value **parsed**. Whether you `put` a
string or a Buffer doesn't matter — what matters is whether the bytes are valid
JSON. Valid JSON comes back parsed; anything else comes back as a `Buffer`.

```js
// Store an object (JSON-serialized for you) → read it back parsed.
db.put("obj", { ok: true })
db.get("obj") // → { ok: true }

// A stored scalar coerces per JSON parse rules.
db.put("n", "123")
db.get("n") // → 123  (the number, not the string "123")

// Want to store NON-JSON content? Put a Buffer. It reads back as a Buffer,
// byte-exact. (If you pass a non-JSON string, ntee-db stores it fine and still
// hands it back as a Buffer — but a Buffer makes the intent explicit.)
db.put("blob", Buffer.from([0xff, 0x00, 0x01]))
db.put("text", "hello") // not valid JSON
db.get("blob") // → <Buffer ff 00 01>
db.get("text") // → <Buffer 68 65 6c 6c 6f>

// So: a Buffer coming out means the value was NOT JSON. Guard with Buffer.isBuffer.
const v = db.get("some-key")
if (Buffer.isBuffer(v)) {
  // raw/binary value (or a corrupt record) — handle as bytes
} else {
  // parsed JSON: object / array / scalar (or null if the key is absent)
}
```

## API

| Method                                                        | Returns            | Notes                                                                           |
| ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `NteeDB.open(dir, opts?)`                                     | `NteeDB`           | creates if missing                                                              |
| `NteeDB.destroy(dir)`                                         | `void`             | delete a store's files (no open handle)                                         |
| `put(key, value, ix?)`                                        | `void`             | `value`: object\|string\|Buffer (object → JSON); `ix`: `{name: string\|number}` |
| `putMany(items)`                                              | `Promise<number>`  | one batch off the event loop; in-order; all-or-nothing validation               |
| `get(key)`                                                    | value \| `null`    | the stored JSON parsed (a Buffer for binary/non-JSON)                           |
| `getMany(keys)`                                               | `(value\|null)[]`  | batched get, one crossing; aligned to `keys`                                    |
| `has(key)` / `delete(key)`                                    | `boolean` / `void` |                                                                                 |
| `prefixScan(prefix)`                                          | `string[]`         | sorted keys                                                                     |
| `secIndex / secIndexPrefix / secIndexRange`                   | `string[]`         | primary keys                                                                    |
| `secIndexHas(name, val)`                                      | `boolean`          | any record has `val` in the index (no keys materialized)                        |
| `secIndexRecords / secIndexPrefixRecords / prefixScanRecords` | `{key, value}[]`   | keys + parsed content                                                           |
| `secIndexDropped / secIndexProspective`                       | `string[]`         | schema state                                                                    |
| `compact()` / `reindex()`                                     | `Promise<void>`    | run off the event loop                                                          |
| `close()` / `drop()`                                          | `void`             |                                                                                 |

## Notes / limitations

- **Index values from JS**: pass them explicitly via `put(..., ix)`, or declare a
  `jsonPath` so the value is derived from the record (the only form `reindex()`
  can back-fill). JS-function extractors are not supported.
- **JSON store**: `put` takes a Buffer or string; **store JSON**. Reads return
  the value **parsed** — a stored scalar coerces (`put("k", "123")` reads back as
  the number `123`). A binary or non-JSON value (or a corrupt record) comes back
  as a `Buffer`, so callers can guard with `Buffer.isBuffer`. On disk, valid-UTF-8
  values are stored as plain JSON and only binary as base64.
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
