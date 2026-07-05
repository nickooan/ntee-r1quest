import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NteeDB } from "../src/index.js"

// These tests assert byte-exact storage, so default the helper to buffer mode;
// json-mode behavior is covered by its own tests (a test may override opts).
async function withDB(opts, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "nteedb-"))
  const db = NteeDB.open(dir, { valueFormat: "buffer", ...opts })
  try {
    await fn(db, dir)
  } finally {
    try {
      db.close()
    } catch {}
    await rm(dir, { recursive: true, force: true })
  }
}

test("single-writer lock: second open of the same store throws", async () => {
  await withDB({}, (db, dir) => {
    // The store is held by `db` — a second opener must fail fast.
    assert.throws(() => NteeDB.open(dir, {}), /locked/)
    // The first handle is unaffected.
    db.put("k", "v")
    assert.equal(db.get("k").toString(), "v")
    // After releasing, the store opens again.
    db.close()
    const db2 = NteeDB.open(dir, {})
    assert.equal(db2.get("k").toString(), "v")
    db2.close()
  })
})

test("put/get/has/delete round-trip", async () => {
  await withDB({}, (db) => {
    db.put("alpha", Buffer.from("one"))
    db.put("beta", "two") // string accepted
    assert.equal(db.get("alpha").toString(), "one")
    assert.equal(db.get("beta").toString(), "two")
    assert.equal(db.has("beta"), true)
    assert.equal(db.get("missing"), null)

    db.put("alpha", Buffer.from("ONE"))
    assert.equal(db.get("alpha").toString(), "ONE")

    db.delete("alpha")
    assert.equal(db.get("alpha"), null)
    assert.equal(db.has("alpha"), false)
  })
})

test("putMany batches records (order, indexes, validation, caps)", async () => {
  await withDB(
    { indexes: [{ name: "traceId", kind: "string", maxPerValue: 2 }] },
    async (db) => {
      const n = await db.putMany([
        { key: "call:1", value: "a", ix: { traceId: "T" } },
        { key: "call:2", value: Buffer.from("b"), ix: { traceId: "T" } },
        { key: "call:3", value: "c", ix: { traceId: "T" } },
        { key: "other:1", value: "x" },
        { key: "other:1", value: "y" }, // later item for the same key wins
      ])
      assert.equal(n, 5)

      // Values round-trip; last write in the batch wins.
      assert.equal(db.get("other:1").toString(), "y")
      assert.equal(db.get("call:2").toString(), "b")

      // maxPerValue applied across the batch: only the newest 2 remain.
      assert.deepEqual(db.secIndex("traceId", "T"), ["call:2", "call:3"])
      assert.equal(db.has("call:1"), false)

      // An invalid item rejects the whole batch with nothing written.
      await assert.rejects(
        db.putMany([
          { key: "ok:1", value: "v" },
          { key: "bad:1", value: "v", ix: { nope: "x" } },
        ]),
        /unknown index/,
      )
      assert.equal(db.has("ok:1"), false)

      // Text goes over the wire as a plain string ("s"), binary as base64
      // ("v"), a leading BOM must survive — all byte-exact either way.
      const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xc3, 0x28])
      const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]) // BOM + "hi"
      await db.putMany([
        { key: "batch:text", value: '{"n":1,"emoji":"🎉"}' },
        { key: "batch:bin", value: binary },
        { key: "batch:bom", value: bom },
      ])
      assert.equal(
        db.get("batch:text").toString("utf8"),
        '{"n":1,"emoji":"🎉"}',
      )
      assert.deepEqual(db.get("batch:bin"), binary)
      assert.deepEqual(db.get("batch:bom"), bom)
    },
  )
})

test("prefix scan", async () => {
  await withDB({}, (db) => {
    for (const k of [
      "input:Get",
      "input:GetProperty",
      "input:GetPropertyNames",
      "api:/x",
      "input:SetX",
    ]) {
      db.put(k, "v")
    }
    assert.deepEqual(db.prefixScan("input:GetP"), [
      "input:GetProperty",
      "input:GetPropertyNames",
    ])
    assert.equal(db.prefixScan("input:").length, 4)
  })
})

test("text and invalid-UTF-8 binary values round-trip byte-exactly", async () => {
  await withDB({}, (db) => {
    // Text values are stored as readable JSON strings on disk ("s" field);
    // binary stays base64 ("v") — either way the bytes come back identical.
    const text = '{"endpoint":"/api/users","note":"emoji 🎉"}'
    db.put("text", text)
    assert.equal(db.get("text").toString("utf8"), text)

    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xc3, 0x28])
    db.put("bin", binary)
    assert.deepEqual(db.get("bin"), binary)

    db.put("empty", "")
    assert.deepEqual(db.get("empty"), Buffer.alloc(0))
  })
})

test("binary values survive (blob path)", async () => {
  await withDB({ blobThreshold: 32 }, (db) => {
    const big = Buffer.alloc(4096, 0xab)
    db.put("blob", big)
    assert.ok(db.get("blob").equals(big))
  })
})

test("getMany: order preserved, missing → null, text/binary/blob values", async () => {
  await withDB({ blobThreshold: 32 }, (db) => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01])
    const big = Buffer.alloc(4096, 0xcd) // over blobThreshold → blob path
    db.put("text", "hello")
    db.put("bin", binary)
    db.put("blob", big)

    const got = db.getMany(["blob", "missing", "text", "bin"])
    assert.equal(got.length, 4)
    assert.ok(got[0].equals(big)) // aligned to input order
    assert.equal(got[1], null) // absent key → null
    assert.equal(got[2].toString(), "hello")
    assert.deepEqual(got[3], binary)

    assert.deepEqual(db.getMany([]), []) // empty input
  })
})

test("valueFormat json (default): reads return parsed JSON, with Buffer fallback", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nteedb-"))
  const db = NteeDB.open(dir, {
    indexes: [{ name: "traceId", kind: "string" }],
  }) // no valueFormat → default is json
  try {
    const obj = { endpoint: "/api/users", status: 200, tags: ["a", "b"] }
    db.put("rec", JSON.stringify(obj), { traceId: "T1" })
    db.put("rec2", JSON.stringify({ n: 2 }), { traceId: "T1" })
    db.put("text", "hello") // not valid JSON → Buffer fallback
    db.put("bin", Buffer.from([0xff, 0x00, 0x01])) // binary → Buffer

    // get: parsed object, not a Buffer.
    assert.deepEqual(db.get("rec"), obj)
    assert.equal(db.get("missing"), null)
    // Non-JSON and binary fall back to Buffer.
    assert.ok(Buffer.isBuffer(db.get("text")))
    assert.equal(db.get("text").toString(), "hello")
    assert.deepEqual(db.get("bin"), Buffer.from([0xff, 0x00, 0x01]))

    // getMany + secIndexRecords return parsed values too.
    assert.deepEqual(db.getMany(["rec", "missing"]), [obj, null])
    const recs = db.secIndexRecords("traceId", "T1")
    assert.deepEqual(
      recs.map((r) => r.value),
      [obj, { n: 2 }],
    )

    // Scalar coercion under json (documented): "123" → number 123.
    db.put("num", "123")
    assert.equal(db.get("num"), 123)
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test("valueFormat buffer: same data comes back byte-exact", async () => {
  await withDB({ valueFormat: "buffer" }, (db) => {
    db.put("rec", JSON.stringify({ n: 1 }))
    db.put("num", "123")
    assert.ok(Buffer.isBuffer(db.get("rec")))
    assert.equal(db.get("rec").toString(), '{"n":1}')
    assert.equal(db.get("num").toString(), "123") // string, not the number 123
  })
})

test("secondary indexes: explicit values, multi-value, range, prefix", async () => {
  await withDB(
    {
      indexes: [
        { name: "traceId", kind: "string" },
        { name: "status", kind: "number" },
      ],
    },
    (db) => {
      db.put("call:1", "{}", { traceId: "T1", status: 200 })
      db.put("call:2", "{}", { traceId: "T1", status: 404 })
      db.put("call:3", "{}", { traceId: "T2", status: 200 })

      assert.deepEqual(db.secIndex("traceId", "T1"), ["call:1", "call:2"])
      assert.deepEqual(db.secIndexRange("status", 200, 299), [
        "call:1",
        "call:3",
      ])
      assert.deepEqual(db.secIndexPrefix("traceId", "T"), [
        "call:1",
        "call:2",
        "call:3",
      ])

      // secIndexHas: presence per value, both kinds; false after the value
      // has no more records.
      assert.equal(db.secIndexHas("traceId", "T1"), true)
      assert.equal(db.secIndexHas("traceId", "T9"), false)
      assert.equal(db.secIndexHas("status", 404), true)
      assert.equal(db.secIndexHas("status", 500), false)
      assert.throws(() => db.secIndexHas("nope", "x"), /unknown index/)

      db.delete("call:1")
      assert.deepEqual(db.secIndex("traceId", "T1"), ["call:2"])
      db.delete("call:2")
      assert.equal(db.secIndexHas("traceId", "T1"), false) // both gone
    },
  )
})

test("secIndexPrefix grouped +/-N limit + secIndexPrefixRecords records", async () => {
  await withDB({ indexes: [{ name: "endpoint", kind: "string" }] }, (db) => {
    // Two records under GetXXXMutation, one under GetXXXMumu. Sorted by
    // (value, pk): GetXXXMumu < GetXXXMutation ('m' < 't').
    db.put("call:1", "a", { endpoint: "GetXXXMutation" })
    db.put("call:2", "b", { endpoint: "GetXXXMutation" })
    db.put("call:3", "c", { endpoint: "GetXXXMumu" })

    // limit 0 (default) is unchanged: all matches, flat, in (value, pk) order.
    assert.deepEqual(db.secIndexPrefix("endpoint", "GetXXXM"), [
      "call:3",
      "call:1",
      "call:2",
    ])
    // -1: last record of each endpoint (groups ascending by value).
    assert.deepEqual(db.secIndexPrefix("endpoint", "GetXXXM", -1), [
      "call:3",
      "call:2",
    ])
    // +1: first record of each endpoint.
    assert.deepEqual(db.secIndexPrefix("endpoint", "GetXXXM", 1), [
      "call:3",
      "call:1",
    ])

    // secIndexPrefixRecords returns full records in the same order.
    const recs = db.secIndexPrefixRecords("endpoint", "GetXXXM", -1)
    assert.deepEqual(
      recs.map((r) => r.key),
      ["call:3", "call:2"],
    )
    assert.equal(recs[0].value.toString(), "c")
    assert.equal(recs[1].value.toString(), "b")
  })
})

test("removeByPkLess / removeByPkGreater (range delete, count, secondary sweep)", async () => {
  await withDB(
    { indexes: [{ name: "traceId", kind: "string" }] },
    async (db) => {
      for (let i = 1; i <= 5; i++)
        db.put(`call:${i}`, "{}", { traceId: `T${i}` })

      // Strict: call:3 (the cutoff) survives; call:1/2 removed. Resolves to count.
      assert.equal(await db.removeByPkLess("call:3"), 2)
      assert.equal(db.get("call:1"), null)
      assert.equal(db.has("call:3"), true)
      // Secondary swept — no ghost for a deleted key.
      assert.deepEqual(db.secIndex("traceId", "T1"), [])
      assert.deepEqual(db.secIndex("traceId", "T3"), ["call:3"])

      // Strict greater: call:4/5 removed, call:3 kept.
      assert.equal(await db.removeByPkGreater("call:3"), 2)
      assert.equal(db.has("call:4"), false)
      assert.equal(db.has("call:3"), true)
      assert.deepEqual(db.secIndex("traceId", "T5"), [])

      // No-op range removes nothing.
      assert.equal(await db.removeByPkLess("call:3"), 0)
    },
  )
})

test("maxPerValue caps records per index value (oldest evicted)", async () => {
  await withDB(
    { indexes: [{ name: "traceId", kind: "string", maxPerValue: 2 }] },
    (db) => {
      db.put("call:1", "a", { traceId: "T" })
      db.put("call:2", "b", { traceId: "T" })
      // Third record with the same value: lowest pk (call:1) is fully deleted.
      db.put("call:3", "c", { traceId: "T" })

      assert.equal(db.get("call:1"), null)
      assert.equal(db.has("call:1"), false)
      assert.deepEqual(db.secIndex("traceId", "T"), ["call:2", "call:3"])

      // A different value has its own budget.
      db.put("other:1", "x", { traceId: "U" })
      assert.deepEqual(db.secIndex("traceId", "U"), ["other:1"])
      assert.deepEqual(db.secIndex("traceId", "T"), ["call:2", "call:3"])
    },
  )
})

test("secIndex limit + direction (first N asc / last N desc)", async () => {
  await withDB({ indexes: [{ name: "traceId", kind: "string" }] }, (db) => {
    for (let i = 1; i <= 6; i++) db.put(`call:${i}`, "{}", { traceId: "T" })
    assert.deepEqual(db.secIndex("traceId", "T"), [
      "call:1",
      "call:2",
      "call:3",
      "call:4",
      "call:5",
      "call:6",
    ])
    assert.deepEqual(db.secIndex("traceId", "T", 3), [
      "call:1",
      "call:2",
      "call:3",
    ]) // first 3 asc
    assert.deepEqual(db.secIndex("traceId", "T", -2), ["call:6", "call:5"]) // last 2 desc
    assert.deepEqual(db.secIndex("traceId", "T", 100), [
      "call:1",
      "call:2",
      "call:3",
      "call:4",
      "call:5",
      "call:6",
    ]) // clamps
    assert.deepEqual(db.secIndex("traceId", "missing", -5), [])
    const recent = db.secIndexRecords("traceId", "T", -2)
    assert.deepEqual(
      recent.map((r) => r.key),
      ["call:6", "call:5"],
    )
  })
})

test("jsonPath extractor + secIndexRecords returns records", async () => {
  await withDB(
    { indexes: [{ name: "kind", kind: "string", jsonPath: "kind" }] },
    (db) => {
      db.put("r1", JSON.stringify({ kind: "request", n: 1 }))
      db.put("r2", JSON.stringify({ kind: "history", n: 2 }))
      db.put("r3", JSON.stringify({ kind: "request", n: 3 }))

      const recs = db.secIndexRecords("kind", "request")
      assert.deepEqual(
        recs.map((r) => r.key),
        ["r1", "r3"],
      )
      assert.equal(JSON.parse(recs[0].value.toString()).n, 1)
    },
  )
})

test("reopen restores state", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nteedb-"))
  try {
    const db = NteeDB.open(dir, {})
    db.put("a", "1")
    db.put("b", "2")
    db.delete("b")
    db.close()

    const db2 = NteeDB.open(dir, {})
    assert.equal(db2.get("a").toString(), "1")
    assert.equal(db2.get("b"), null)
    db2.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("async compact and reindex", async () => {
  await withDB(
    { indexes: [{ name: "kind", kind: "string", jsonPath: "kind" }] },
    async (db) => {
      db.put("r1", JSON.stringify({ kind: "a" }))
      db.put("r1", JSON.stringify({ kind: "a" })) // dead record
      db.put("r2", JSON.stringify({ kind: "b" }))
      await db.compact()
      assert.deepEqual(db.secIndex("kind", "a"), ["r1"])
      await db.reindex()
      assert.deepEqual(db.secIndex("kind", "b"), ["r2"])
    },
  )
})

test("error surfaces as thrown Error", async () => {
  await withDB({ indexes: [{ name: "status", kind: "number" }] }, (db) => {
    assert.throws(
      () => db.put("k", "v", { unknownIndex: "x" }),
      /unknown index/,
    )
    assert.throws(() => db.secIndex("nope", "x"), /unknown index/)
  })
})

test("drop deletes the store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nteedb-"))
  try {
    const db = NteeDB.open(dir, {})
    db.put("a", "1")
    db.drop()
    const db2 = NteeDB.open(dir, {})
    assert.equal(db2.has("a"), false)
    db2.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("no memory leak across many calls (RSS stays bounded)", async () => {
  await withDB({}, (db) => {
    const big = Buffer.alloc(64 * 1024, 0x7a) // 64 KiB
    for (let i = 0; i < 50; i++) db.put("k" + i, big)
    if (global.gc) global.gc()
    const before = process.memoryUsage().rss
    for (let i = 0; i < 20000; i++) {
      const v = db.get("k" + (i % 50))
      assert.equal(v.length, big.length)
    }
    if (global.gc) global.gc()
    const after = process.memoryUsage().rss
    // 20k gets of a 64 KiB value would balloon RSS if the C buffers leaked.
    const growthMB = (after - before) / (1024 * 1024)
    assert.ok(
      growthMB < 64,
      `RSS grew ${growthMB.toFixed(1)} MB across 20k gets (possible leak)`,
    )
  })
})
