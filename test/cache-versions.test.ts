import {
  afterAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Isolate the cache home so these tests never touch the developer's real cache.
const isolatedHome = mkdtempSync(join(tmpdir(), "r1quest-cache-versions-"))

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const {
  recordSnapshot,
  getSnapshot,
  listSnapshots,
  deleteSnapshots,
  clearCache,
} = await import("../src/runtime/cache/index.ts")

describe("file-version snapshots", () => {
  beforeEach(async () => {
    await clearCache()
  })

  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  test("records and reads back a snapshot by seq", async () => {
    await recordSnapshot("/proj/req.nts", 1, "edit", "hello")
    const got = await getSnapshot(1)
    expect(got?.content).toBe("hello")
    expect(got?.kind).toBe("edit")
    expect(got?.filename).toBe("req.nts")
    expect(got?.path).toBe("/proj/req.nts")
  })

  test("lists snapshots for a file newest-first", async () => {
    await recordSnapshot("/proj/a.nts", 1, "edit", "v1")
    await recordSnapshot("/proj/a.nts", 2, "save", "v2")
    await recordSnapshot("/proj/a.nts", 3, "edit", "v3")
    // A different file must not appear.
    await recordSnapshot("/proj/b.nts", 4, "edit", "other")

    const metas = await listSnapshots("/proj/a.nts")
    expect(metas.map((m) => m.seq)).toEqual([3, 2, 1])
    expect(metas[0]?.kind).toBe("edit")
    expect(metas[1]?.kind).toBe("save")
  })

  test("caps history at 50 per file, evicting the oldest", async () => {
    for (let seq = 1; seq <= 51; seq++) {
      await recordSnapshot("/proj/big.nts", seq, "edit", `v${seq}`)
    }
    const metas = await listSnapshots("/proj/big.nts", 100)
    expect(metas.length).toBe(50)
    // The newest survive; the oldest (seq 1) was evicted.
    expect(metas[0]?.seq).toBe(51)
    expect(metas[metas.length - 1]?.seq).toBe(2)
    expect(await getSnapshot(1)).toBeUndefined()
    expect((await getSnapshot(51))?.content).toBe("v51")
  })

  test("deletes snapshots by seq", async () => {
    await recordSnapshot("/proj/c.nts", 1, "edit", "x")
    await recordSnapshot("/proj/c.nts", 2, "edit", "y")
    await deleteSnapshots([1])
    expect(await getSnapshot(1)).toBeUndefined()
    expect((await getSnapshot(2))?.content).toBe("y")
    expect((await listSnapshots("/proj/c.nts")).map((m) => m.seq)).toEqual([2])
  })
})
