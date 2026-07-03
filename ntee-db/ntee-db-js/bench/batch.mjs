// putMany benchmark: N records in one FFI call, off the event loop.
// Single pass; run a few times and average.
// Run from the package root: node bench/batch.mjs
import { NteeDB } from "../src/index.js"
import { rmSync } from "node:fs"

const N = 20_000
const value = JSON.stringify({ endpoint: "/api/users [get]", status: 200 })
const key = (i) => "api:" + String(i).padStart(16, "0")

rmSync("./ntee-batch", { recursive: true, force: true })
const db = NteeDB.open("./ntee-batch", {})
const items = Array.from({ length: N }, (_, i) => ({ key: key(i), value }))
const t0 = performance.now()
await db.putMany(items) // one FFI call, off the event loop
console.log(
  `putMany (${N}): ${(((performance.now() - t0) * 1000) / N).toFixed(1)} µs/op`,
)
db.drop()
process.exit(0) // koffi keeps the event loop alive; force a clean exit
