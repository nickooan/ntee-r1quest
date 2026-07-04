// Minimal end-to-end example: open, write with a secondary index, search,
// reopen, and read recovered state.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NteeDB } from "./src/index.js"

const dir = mkdtempSync(path.join(tmpdir(), "nteedb-example-"))

let db = NteeDB.open(dir, {
  indexes: [
    { name: "traceId", kind: "string" },
    { name: "kind", kind: "string", jsonPath: "kind" }, // auto-derived from JSON
  ],
})

db.put("call:1", JSON.stringify({ kind: "request", url: "/orders" }), {
  traceId: "T1",
})
db.put("call:2", JSON.stringify({ kind: "request", url: "/items" }), {
  traceId: "T1",
})
db.put("call:3", JSON.stringify({ kind: "history", url: "/x" }), {
  traceId: "T2",
})

console.log("by traceId T1:", db.secIndex("traceId", "T1"))
console.log("by kind=request:", db.secIndex("kind", "request"))
console.log(
  "secIndexRecords kind=request:",
  db
    .secIndexRecords("kind", "request")
    .map((r) => ({ key: r.key, value: JSON.parse(r.value.toString()) })),
)

db.close()

// Reopen — state is recovered from disk.
db = NteeDB.open(dir, {
  indexes: [
    { name: "traceId", kind: "string" },
    { name: "kind", kind: "string" },
  ],
})
console.log(
  "after reopen, get call:1:",
  JSON.parse(db.get("call:1").toString()),
)
db.close()

rmSync(dir, { recursive: true, force: true })
console.log("done")
