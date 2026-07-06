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

// Point the cache at an isolated home so these tests never touch the
// developer's real ~/.ntee-r1quest/cache. os.homedir() must be mocked before
// the cache module (which resolves the directory at open time) is imported.
const isolatedHome = mkdtempSync(join(tmpdir(), "r1quest-cache-trace-"))

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const { recordApiCall, listTraceCalls, listApiEndpoints, clearCache } =
  await import("../src/runtime/cache/index.ts")

const call = (path: string, method: string, traceId?: string) => ({
  at: 0,
  durationMs: 1,
  traceId,
  request: {
    url: `https://h${path}`,
    method,
    headers: {},
    body: undefined,
  },
  response: { status: 200, headers: {}, data: { path } },
})

describe("trace index", () => {
  beforeEach(async () => {
    await clearCache()
  })

  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  test("appends calls sharing a trace id in call order", async () => {
    await recordApiCall(call("/a", "GET", "batch-1"))
    await recordApiCall(call("/b", "POST", "batch-1"))
    // A repeat of an endpoint is kept as its own entry in the trace.
    await recordApiCall(call("/a", "GET", "batch-1"))

    const trace = await listTraceCalls("batch-1")

    expect(trace.map((entry) => entry.endpoint)).toEqual([
      "/a [get]",
      "/b [post]",
      "/a [get]",
    ])
    expect(trace.every((entry) => entry.traceId === "batch-1")).toBe(true)
  })

  test("keeps separate trace ids independent and skips untraced calls", async () => {
    await recordApiCall(call("/a", "GET", "one"))
    await recordApiCall(call("/b", "GET", "two"))
    await recordApiCall(call("/c", "GET")) // no trace id

    expect((await listTraceCalls("one")).map((entry) => entry.path)).toEqual([
      "/a",
    ])
    expect((await listTraceCalls("two")).map((entry) => entry.path)).toEqual([
      "/b",
    ])
    expect(await listTraceCalls("missing")).toEqual([])

    // Untraced and traced calls alike still land in the endpoint index.
    expect(await listApiEndpoints()).toHaveLength(3)
  })

  test("clearCache empties the trace index", async () => {
    await recordApiCall(call("/a", "GET", "gone"))
    await clearCache()

    expect(await listTraceCalls("gone")).toEqual([])
  })
})
