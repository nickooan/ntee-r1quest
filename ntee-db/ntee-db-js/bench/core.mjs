// Main-table benchmark: ntee-db vs lmdb on a cache-shaped workload.
// Mean of 5 rounds, fresh store per round, warm-up round discarded.
// Run from the package root: npm i --no-save lmdb && node bench/core.mjs
import { open as lmdbOpen } from "lmdb"
import { NteeDB } from "../src/index.js"
import { rmSync } from "node:fs"

const N = 20_000
const ROUNDS = 5
const value = JSON.stringify({
  endpoint: "/api/users [get]",
  status: 200,
  durationMs: 42,
  headers: { "content-type": "application/json" },
  data: { id: 123, name: "some user", tags: ["a", "b"] },
})
const key = (i) => `api:${String(i).padStart(16, "0")}`

const sums = new Map()

async function round(warmup) {
  const time = async (label, fn) => {
    const t0 = performance.now()
    await fn()
    const ms = performance.now() - t0
    if (warmup) return
    if (!sums.has(label)) sums.set(label, [])
    sums.get(label).push(ms)
  }

  rmSync("./ntee-store", { recursive: true, force: true })
  const ndb = NteeDB.open("./ntee-store", {})
  await time("ntee-db put (sync)", () => {
    for (let i = 0; i < N; i++) ndb.put(key(i), value)
  })
  await time("ntee-db get", () => {
    for (let i = 0; i < N; i++) ndb.get(key(i))
  })
  await time("ntee-db has", () => {
    for (let i = 0; i < N; i++) ndb.has(key(i))
  })
  await time("ntee-db prefixScan all [total]", () => {
    ndb.prefixScan("api:")
  })
  ndb.close()

  // putMany: one batch, one FFI call, off the event loop.
  rmSync("./ntee-batch", { recursive: true, force: true })
  const nb = NteeDB.open("./ntee-batch", {})
  const items = Array.from({ length: N }, (_, i) => ({ key: key(i), value }))
  await time("ntee-db putMany (one batch)", () => nb.putMany(items))
  nb.drop()

  // The app's boot-optimization config: periodic hints (async, background).
  rmSync("./ntee-hints", { recursive: true, force: true })
  const nh = NteeDB.open("./ntee-hints", { hintEveryN: 5 })
  await time("ntee-db put (sync, hintEveryN=5)", () => {
    for (let i = 0; i < N; i++) nh.put(key(i), value)
  })
  nh.close()

  rmSync("./lmdb-store", { recursive: true, force: true })
  const ldb = lmdbOpen({ path: "./lmdb-store" })
  await time("lmdb putSync", () => {
    for (let i = 0; i < N; i++) ldb.putSync(key(i), value)
  })
  await time("lmdb put (async batched)", async () => {
    let last
    for (let i = 0; i < N; i++) last = ldb.put(key(i), value)
    await last // batched async transactions — lmdb-js's fast path
  })
  await time("lmdb get", () => {
    for (let i = 0; i < N; i++) ldb.get(key(i))
  })
  await time("lmdb doesExist", () => {
    for (let i = 0; i < N; i++) ldb.doesExist(key(i))
  })
  await time("lmdb range scan all [total]", () => {
    ;[...ldb.getKeys({ start: "api:", end: "api;" })]
  })
  await ldb.close()
  console.error(warmup ? "warmup round done" : "round done")
}

await round(true)
for (let r = 0; r < ROUNDS; r++) await round(false)

console.log(`\nmean of ${ROUNDS} rounds, N=${N}:`)
for (const [label, times] of sums) {
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  console.log(
    label.includes("[total]")
      ? `${label}: ${mean.toFixed(1)} ms`
      : `${label}: ${((mean * 1000) / N).toFixed(1)} µs/op`,
  )
}
process.exit(0) // koffi keeps the event loop alive; force a clean exit
