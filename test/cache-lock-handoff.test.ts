import { afterAll, describe, expect, jest, test } from "@jest/globals"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NteeDB } from "@ntee/ntee-db"

// Isolate the cache home so these tests never touch the developer's real cache.
const isolatedHome = mkdtempSync(join(tmpdir(), "r1quest-cache-lock-"))

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const { recordInput, suggestInputs, closeCache } =
  await import("../src/runtime/cache/index.ts")

const cacheDirectory = join(isolatedHome, ".ntee-r1quest", "cache")

describe("cache single-writer lock hand-off", () => {
  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  test("closeCache releases the store lock for another process", async () => {
    // Using the cache opens the store and takes the single-writer lock —
    // exactly what the CLI entry does during startup housekeeping.
    await recordInput("get users")
    expect(await suggestInputs("get")).toEqual(["get users"])

    // While held, another opener (the TUI runtime server, in reality a
    // separate process) is locked out.
    expect(() => NteeDB.open(cacheDirectory, {})).toThrow(/locked/)

    // closeCache is the hand-off the entry performs before launching the TUI:
    // the next opener must succeed.
    closeCache()
    const takenOver = NteeDB.open(cacheDirectory, {})
    expect((await takenOver.prefixScan("input:")).length).toBeGreaterThan(0)

    // And while the "runtime server" holds it, this process degrades to a
    // no-op instead of breaking.
    await recordInput("another input")
    expect(await suggestInputs("another")).toEqual([])

    // Releasing again lets this process re-open on demand (memoization reset).
    takenOver.close()
    closeCache() // clear the openFailed latch from the locked attempt
    await recordInput("after handback")
    expect(await suggestInputs("after")).toEqual(["after handback"])
  })
})
