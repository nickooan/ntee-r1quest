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
// os.homedir() must be mocked before the cache module (which resolves the
// directory at open time) is imported.
const isolatedHome = mkdtempSync(
  join(tmpdir(), "r1quest-cache-endpoint-prefix-"),
)

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const { recordApiCall, listApiEndpointsByPrefix, clearCache } =
  await import("../src/runtime/cache/index.ts")

const call = (path: string, at: number) => ({
  at,
  durationMs: 1,
  request: {
    url: `https://h${path}`,
    method: "GET",
    headers: {},
    body: undefined,
  },
  response: { status: 200, headers: {}, data: { path, at } },
})

describe("listApiEndpointsByPrefix", () => {
  beforeEach(async () => {
    await clearCache()
  })

  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  test("returns the latest call per matching endpoint, in label order", async () => {
    // Two calls to /api/users (the second is newer), one to /api/orders, and one
    // unrelated endpoint that must be excluded by the prefix.
    await recordApiCall(call("/api/users", 10))
    await recordApiCall(call("/api/orders", 20))
    await recordApiCall(call("/api/users", 30)) // newer /api/users
    await recordApiCall(call("/other", 40))

    const matches = listApiEndpointsByPrefix("/api")

    // One row per endpoint, ordered by label ("/api/orders" < "/api/users").
    expect(matches.map((r) => r.endpoint)).toEqual([
      "/api/orders [get]",
      "/api/users [get]",
    ])
    // The /api/users row is the newer of its two calls.
    const users = matches.find((r) => r.endpoint === "/api/users [get]")
    expect(users?.at).toBe(30)
  })

  test("returns empty when nothing matches the prefix", async () => {
    await recordApiCall(call("/api/users", 1))

    expect(listApiEndpointsByPrefix("/nope")).toEqual([])
  })
})
