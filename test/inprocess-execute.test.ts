import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"

// Isolate the global-config lookup from the developer's real
// ~/.ntee-r1quest/r1qconfig.yaml (see cli-command.test.ts for why the module
// is mocked instead of setting HOME).
const isolatedHome = mkdtempSync(join(tmpdir(), "r1quest-home-isolate-"))

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const { resolveRuntimeConfig } = await import("../src/runtime/cli-command.ts")
const { InProcessRuntimeClient } =
  await import("../src/runtime/client/inprocess-runtime-client.ts")

const server = setupServer()
const root = join(process.cwd(), "test/data")

const createClient = () => {
  const args = ["-r", root]
  return new InProcessRuntimeClient(args, resolveRuntimeConfig(args))
}

describe("in-process execute", () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" })
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  test("executes a plain request without chain metadata", async () => {
    server.use(
      http.get("https://ntee.io", () => HttpResponse.json({ ok: true })),
    )

    const result = await createClient().execute({ command: "get" })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(result.traceId).toBeUndefined()
    expect(result.stepCount).toBeUndefined()
    expect(result.failedStep).toBeUndefined()
  })

  test("executes a joint file and returns the final response with chain metadata", async () => {
    server.use(
      http.get("https://ntee.io", () =>
        HttpResponse.json({ data: [{ userId: 7 }] }),
      ),
      http.post("https://ntee.io", () => HttpResponse.json({ created: true })),
    )

    const result = await createClient().execute({ command: "joint" })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ created: true })
    expect(result.traceId).toBe("joint-trace")
    expect(result.stepCount).toBe(2)
    expect(result.failedStep).toBeUndefined()
  })

  test("prefers the request trace id over the @joint declaration", async () => {
    server.use(
      http.get("https://ntee.io", () =>
        HttpResponse.json({ data: [{ userId: 7 }] }),
      ),
      http.post("https://ntee.io", () => HttpResponse.json({ ok: true })),
    )

    const result = await createClient().execute({
      command: "joint",
      traceId: "rpc-trace",
    })

    expect(result.traceId).toBe("rpc-trace")
  })

  test("resolves a chain step that failed with an HTTP response", async () => {
    server.use(
      http.get("https://ntee.io", () =>
        HttpResponse.json({ data: [{ userId: 7 }] }),
      ),
      http.post("https://ntee.io", () =>
        HttpResponse.json({ error: "nope" }, { status: 500 }),
      ),
    )

    const result = await createClient().execute({ command: "joint" })

    expect(result.status).toBe(500)
    expect(result.body).toEqual({ error: "nope" })
    expect(result.traceId).toBe("joint-trace")
    expect(result.failedStep).toBe("2/2 (post)")
    expect(result.stepCount).toBeUndefined()
  })

  test("rejects with step context when a chain fails without a response", async () => {
    server.use(
      // No `data` key, so the second step's json path pick cannot resolve.
      http.get("https://ntee.io", () => HttpResponse.json({ ok: true })),
    )

    await expect(createClient().execute({ command: "joint" })).rejects.toThrow(
      /Joint step 2\/2 \(post\) failed\. Cannot resolve json path "data\[0\]\.userId"/,
    )
  })
})
