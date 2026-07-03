# @ntee/ntee-db (Node.js binding)

In-process Node.js binding for **nteedb** — a pure-Go embedded log-structured
KV store with prefix search and secondary indexes. The Go core is exposed as a
C-shared library and loaded via [koffi](https://koffi.dev) (FFI). No separate
process; same model as `lmdb`/`better-sqlite3` (prebuilt native binaries per
platform).

## Performance

Microbenchmark vs `lmdb` (lmdb-js) from Node, on a cache-shaped workload:
20,000 records, ~120-byte JSON values, time-ordered keys
(`api:<zero-padded-id>`). Apple M2 Pro, Node 24. Each figure is the **mean of
5 rounds** (fresh store per round, warm-up round discarded). The test code is
in the [appendix at the bottom](#appendix-benchmark-code).

| Operation                    | @ntee/ntee-db | lmdb                       | Faster            |
| ---------------------------- | ------------- | -------------------------- | ----------------- |
| `get`                        | 6.2 µs/op     | 0.8 µs/op                  | lmdb ~8×          |
| exists check                 | 1.3 µs/op     | 0.6 µs/op                  | lmdb ~2×          |
| put (non-durable path)       | 4.7 µs/op     | 0.9 µs/op (async, batched) | lmdb ~5×          |
| `putMany` (one 20k batch)    | 5.2 µs/op     | 0.9 µs/op (async, batched) | lmdb ~6×          |
| **put (synchronous commit)** | **4.7 µs/op** | 2,827 µs/op (`putSync`)    | **ntee-db ~600×** |
| put (sync, `hintEveryN: 5`)  | ~19 µs/op     | —                          |                   |
| prefix scan, all 20k keys    | **3.7 ms**    | 5.8 ms (range scan)        | **ntee-db ~1.6×** |

Since the readable-values format (text stored as JSON strings in `main.jsonl`
instead of base64), put/get pay ~0.5–1 µs more on JSON-heavy payloads — string
escaping/unescaping costs more than base64 for quote-dense content. The trade
buys a grep-able log and ~25% smaller records; still microseconds either way.
It also makes `putMany` slightly _slower per-op than plain put_ for text
values (the batch base64-encodes for the FFI envelope AND escapes for disk) —
its wins are the free event loop and the single fsync, not per-op cost.

The `hintEveryN: 5` row is the app's boot-optimization config: periodic hint
rewrites run in a **background goroutine**, so a put only pays a cheap
in-memory snapshot (~14 µs at this uncapped 20k size — before hints went
async, this same row measured **~1.3 ms/op**, a ~70× improvement).

Note: `prefixScan` above is the **primary-key** prefix scan — it needs no index
declaration (the PK index always exists), and lmdb's counterpart is likewise a
PK range scan, so that row is like-for-like.

`putMany` batches N records into one FFI call (one lock, one fsync in durable
mode) and runs **off the event loop**. Read its row honestly: for text values
it is not a per-op saving at all (the batch's own base64/JSON envelope costs
about what the saved crossings gain). Its real wins are that a bulk load does
not block the JS thread at all, and in durable mode it costs **one fsync
instead of N** — while still resolving only when every record is appended (no
lmdb-style exit-loss window).

**Indexed workload** — the app's real shape: every write carries two secondary
index values (`endpoint`, `traceId`); 20k records across 500 distinct
endpoints. lmdb has no built-in secondary indexes, so its "latest per endpoint"
counterpart is what the pre-ntee-db app code did — full scan + parse + dedup in
JS (a hand-rolled dupsort index is possible, but that's exactly the app-side
code this store replaces):

| Operation                                   | @ntee/ntee-db         | lmdb                          | Faster            |
| ------------------------------------------- | --------------------- | ----------------------------- | ----------------- |
| put carrying 2 index values (sync)          | 16.8 µs/op            | 1.1 µs/op (async, no indexes) | lmdb\*            |
| put, full app config\*\*                    | 67 µs/op              | —                             |                   |
| latest call of one endpoint (`byIndex`, -1) | 2.4 µs/op             | —                             |                   |
| **latest call of every endpoint (500/20k)** | **0.1 ms** (one call) | 19.4 ms (scan + dedup)        | **ntee-db ~190×** |

\* not equivalent work: lmdb's put maintains no indexes — the index cost lands
on every query instead (the 19.4 ms row).

\*\* the app's exact open options: 2 indexes + `maxPerValue: 5` on `endpoint` +
`hintEveryN: 5`. The extra cost over the plain indexed put is real retention
work: this run performs ~17.5k automatic evictions (each a durable tombstone
delete) to hold every endpoint at its 5 newest records — the price of the store
never growing. Still synchronous and imperceptible at human pace.

How to read this honestly:

- **Single-op reads: lmdb wins (~7×).** It is a memory-mapped B+tree in C with
  zero-copy reads; an ntee-db `get` pays an FFI crossing + a `pread` +
  JSON/base64 marshaling. Both are microseconds — for tens of ops per user
  interaction the difference is imperceptible.
- **Synchronous writes: ntee-db wins (~600×).** The append-only log makes a
  caller-synchronous write a single ~5 µs append, so a CLI that exits right
  after a request still persists its record. lmdb's equivalent (`putSync`)
  commits a copy-on-write transaction per call (~2.8 ms); its fast write path
  is async/batched — similar durability to ntee-db's default, but not
  synchronous to the caller.
- **Scans: ntee-db wins (~2×; ~180× once indexes matter).** Keys live in a
  RAM-resident sorted index, and grouped queries like
  `byIndexPrefix(name, prefix, -1)` ("newest record per matching value") are
  one bounded native call — 0.1 ms for 500 endpoints, vs 18.4 ms for the
  scan+dedup-in-JS equivalent lmdb requires.
- **Index maintenance costs writes ~4×** (16.8 µs vs 4.1 µs plain) — the write
  pays once so every query stays bounded. Still synchronous and still
  negligible at human pace.
- **Where lmdb fundamentally wins:** very large datasets (ntee-db keeps all
  keys in RAM and pays an O(n) boot scan — ~100 ms at 100k keys), multi-process
  access, and full ACID transactions.

### Why r1quest uses ntee-db

r1quest is a local app on the user's own device, and that shapes the decision
more than any single benchmark row. At this scale **both engines are "fast
enough"** — the accurate summary is not "ntee-db is faster", it's: _ntee-db is
faster exactly where this app is sensitive, decent everywhere else, and
structurally immune to its own weaknesses at this scale._

- **Sync writes are the hot requirement.** One-shot CLI runs exit immediately
  after the request, so "the record is on disk before the process exits" must
  be the _default_ write path. With ntee-db it is: ~17 µs for the app's real
  write (a record carrying both index values) — still ~160× cheaper than lmdb's
  per-call commit, _before_ lmdb pays anything for index upkeep. With lmdb it
  was a tradeoff to manage: the fast async path risks losing the final write at
  exit, and the safe path pays a per-call transaction commit.
- **Reads only need to be decent — and they are.** 5 µs/get means rendering a
  50-endpoint history costs ~0.3 ms; the ~7× read gap would only show up at
  thousands of reads per frame, which a human-paced TUI never does.
- **The features fit is the bigger argument than the numbers — and it is now a
  measured claim.** Secondary indexes (`endpoint`, `traceId`), grouped
  newest-per-value queries, `maxPerValue` retention, and range delete by
  time-ordered key are all used by the app — with lmdb, every one of them was
  (or would be) hand-rolled JS, and the History-list pattern measured 0.1 ms
  via the index vs 18.4 ms as a scan (~180×).
- **ntee-db's weaknesses are structurally avoided.** All-keys-in-RAM and the
  O(n) boot scan never bite because `maxPerValue` caps the store by
  construction and the hint keeps boots fast; a local single-user cache has no
  growth path to "millions of records". Conversely, lmdb's superpowers (huge
  datasets, ACID transactions) were dead weight for this workload.
- **Multi-process is guarded by a single-writer lock.** "Local app" is not
  strictly "single process" — a TUI session plus a one-shot run can briefly
  overlap on the same store. `open` takes an exclusive kernel lock (`flock`) on
  the store; a second opener fails fast and the app degrades that process to a
  cache-less run. The lock is kernel-owned and tied to the process, so it
  releases automatically on any exit — Ctrl+C, crash, `kill -9` — with no
  stale-lock state possible.

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
- **Marshaling**: values cross the boundary as bytes; `get` decodes base64
  internally and returns a `Buffer`.
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

## Appendix: benchmark code

The numbers in [Performance](#performance) come from this script, run in a
scratch project with `npm install lmdb koffi` and this package's `src/` +
`prebuilds/` copied alongside it (`{ "type": "module" }` in its package.json).
Neither store fsyncs per write on its fast path, so durability is comparable;
`lmdb putSync` is included as the only caller-synchronous commit lmdb offers.

```js
import { open as lmdbOpen } from "lmdb"
import { NteeDB } from "./src/index.js"
import { rmSync } from "node:fs"

const N = 20_000
const value = JSON.stringify({
  endpoint: "/api/users [get]",
  status: 200,
  durationMs: 42,
  headers: { "content-type": "application/json" },
  data: { id: 123, name: "some user", tags: ["a", "b"] },
})
const key = (i) => `api:${String(i).padStart(16, "0")}`

const time = (label, fn) => {
  const t0 = performance.now()
  fn()
  const ms = performance.now() - t0
  console.log(
    `${label}: ${ms.toFixed(0)} ms total, ${((ms * 1000) / N).toFixed(1)} µs/op`,
  )
}

// --- ntee-db ---
rmSync("./ntee-store", { recursive: true, force: true })
const ndb = NteeDB.open("./ntee-store", {})
time("ntee-db put (sync)", () => {
  for (let i = 0; i < N; i++) ndb.put(key(i), value)
})
time("ntee-db get", () => {
  for (let i = 0; i < N; i++) ndb.get(key(i))
})
time("ntee-db has", () => {
  for (let i = 0; i < N; i++) ndb.has(key(i))
})
{
  const t0 = performance.now()
  const keys = ndb.prefixScan("api:")
  console.log(
    `ntee-db prefixScan all (${keys.length}): ${(performance.now() - t0).toFixed(1)} ms`,
  )
}
ndb.close()

// --- the app's boot-optimization config: periodic hints (async, background) ---
rmSync("./ntee-hints", { recursive: true, force: true })
const nh = NteeDB.open("./ntee-hints", { hintEveryN: 5 })
time("ntee-db put (sync, hintEveryN=5)", () => {
  for (let i = 0; i < N; i++) nh.put(key(i), value)
})
nh.close()

// --- lmdb ---
rmSync("./lmdb-store", { recursive: true, force: true })
const ldb = lmdbOpen({ path: "./lmdb-store" })
time("lmdb putSync", () => {
  for (let i = 0; i < N; i++) ldb.putSync(key(i), value)
})
{
  const t0 = performance.now()
  let last
  for (let i = 0; i < N; i++) last = ldb.put(key(i), value)
  await last // batched async transactions — lmdb-js's fast path
  const ms = performance.now() - t0
  console.log(
    `lmdb put (async batched): ${ms.toFixed(0)} ms total, ${((ms * 1000) / N).toFixed(1)} µs/op`,
  )
}
time("lmdb get", () => {
  for (let i = 0; i < N; i++) ldb.get(key(i))
})
time("lmdb doesExist", () => {
  for (let i = 0; i < N; i++) ldb.doesExist(key(i))
})
{
  const t0 = performance.now()
  const keys = [...ldb.getKeys({ start: "api:", end: "api;" })]
  console.log(
    `lmdb range scan all (${keys.length}): ${(performance.now() - t0).toFixed(1)} ms`,
  )
}
await ldb.close()
```

The **indexed workload** table comes from this second script (same scratch
project):

```js
import { open as lmdbOpen } from "lmdb"
import { NteeDB } from "./src/index.js"
import { rmSync } from "node:fs"

const N = 20_000
const ENDPOINTS = 500
const endpoint = (i) => `/api/e${String(i % ENDPOINTS).padStart(3, "0")} [get]`
const traceId = (i) => `T${i % 1000}`
const key = (i) => `api:${String(i).padStart(16, "0")}`
const value = (i) =>
  JSON.stringify({
    endpoint: endpoint(i),
    status: 200,
    durationMs: 42,
    data: { id: i, name: "some user" },
  })

const report = (label, ms, ops) =>
  console.log(
    `${label}: ${ms.toFixed(1)} ms total, ${((ms * 1000) / ops).toFixed(1)} µs/op`,
  )

// --- ntee-db, with the app's two secondary indexes declared ---
rmSync("./ntee-ix", { recursive: true, force: true })
const ndb = NteeDB.open("./ntee-ix", {
  indexes: [
    { name: "endpoint", kind: "string" },
    { name: "traceId", kind: "string" },
  ],
})
{
  const t0 = performance.now()
  for (let i = 0; i < N; i++)
    ndb.put(key(i), value(i), { endpoint: endpoint(i), traceId: traceId(i) })
  report("ntee-db put (sync, 2 indexes)", performance.now() - t0, N)
}
{
  const t0 = performance.now()
  for (let i = 0; i < ENDPOINTS; i++) ndb.byIndex("endpoint", endpoint(i), -1)
  report("ntee-db byIndex exact latest", performance.now() - t0, ENDPOINTS)
}
{
  const t0 = performance.now()
  const keys = ndb.byIndexPrefix("endpoint", "/api/", -1)
  console.log(
    `ntee-db byIndexPrefix('/api/', -1) → latest of all ${keys.length} endpoints: ${(performance.now() - t0).toFixed(1)} ms`,
  )
}
ndb.close()

// --- the app's FULL open config: 2 indexes + maxPerValue:5 + hintEveryN:5 ---
rmSync("./ntee-full", { recursive: true, force: true })
const nf = NteeDB.open("./ntee-full", {
  hintEveryN: 5,
  indexes: [
    { name: "endpoint", kind: "string", maxPerValue: 5 },
    { name: "traceId", kind: "string" },
  ],
})
{
  const t0 = performance.now()
  for (let i = 0; i < N; i++)
    nf.put(key(i), value(i), { endpoint: endpoint(i), traceId: traceId(i) })
  report("ntee-db put (FULL app config)", performance.now() - t0, N)
}
nf.close()

// --- lmdb: same records; "latest per endpoint" = scan + parse + dedup in JS ---
rmSync("./lmdb-ix", { recursive: true, force: true })
const ldb = lmdbOpen({ path: "./lmdb-ix" })
{
  const t0 = performance.now()
  let last
  for (let i = 0; i < N; i++) last = ldb.put(key(i), value(i))
  await last
  report("lmdb put (async batched, no ix)", performance.now() - t0, N)
}
{
  const t0 = performance.now()
  const latest = new Map()
  for (const { value: v } of ldb.getRange({ start: "api:", end: "api;" })) {
    const rec = JSON.parse(v)
    latest.set(rec.endpoint, rec)
  }
  console.log(
    `lmdb scan+dedup → latest of all ${latest.size} endpoints: ${(performance.now() - t0).toFixed(1)} ms`,
  )
}
await ldb.close()
```

The `putMany` row comes from this snippet (same scratch project):

```js
import { NteeDB } from "./src/index.js"

const N = 20000
const value = JSON.stringify({ endpoint: "/api/users [get]", status: 200 })
const key = (i) => "api:" + String(i).padStart(16, "0")

const db = NteeDB.open("./ntee-batch", {})
const items = Array.from({ length: N }, (_, i) => ({ key: key(i), value }))
const t0 = performance.now()
await db.putMany(items) // one FFI call, off the event loop
console.log(((performance.now() - t0) * 1000) / N, "µs/op")
db.drop()
```
