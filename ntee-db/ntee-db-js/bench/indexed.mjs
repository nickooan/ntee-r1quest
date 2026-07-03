// Indexed-workload benchmark: the app's real shape — every write carries two
// secondary index values; 20k records across 500 distinct endpoints. lmdb has
// no secondary indexes, so its "latest per endpoint" is scan + parse + dedup.
// Single pass; run a few times and average.
// Run from the package root: npm i --no-save lmdb && node bench/indexed.mjs
import { open as lmdbOpen } from "lmdb"
import { NteeDB } from "../src/index.js"
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
process.exit(0) // koffi keeps the event loop alive; force a clean exit
