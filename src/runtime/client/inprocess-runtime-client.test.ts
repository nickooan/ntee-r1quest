import { describe, expect, test } from "@jest/globals"
import type { AxiosResponse } from "axios"
import {
  InProcessRuntimeClient,
  toExecuteResult,
  type AcpAdapterFactory,
  type AcpAdapterInstance,
} from "./inprocess-runtime-client.ts"
import { VERSION } from "../version.ts"
import type { RuntimeConfig } from "../config.ts"
import type {
  CodexAcpAdapterOptions,
  CodexAcpPermissionRequest,
  CodexAcpResponse,
  CodexAcpWriteInput,
} from "../acp/index.ts"

const makeConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  root: "/tmp/requests",
  customSuggestions: ["x-trace"],
  customCommands: [{ name: "deploy", description: "d", instruction: "i" }],
  sessionCleanupPeriod: 7,
  parsedArgs: {},
  ...overrides,
})

describe("InProcessRuntimeClient.getConfig", () => {
  test("maps RuntimeConfig to the DTO and resolves the adaptor name", async () => {
    const client = new InProcessRuntimeClient(
      [],
      makeConfig({ ai: "Claude", sock: "/tmp/sock" }),
    )

    await expect(client.getConfig()).resolves.toEqual({
      root: "/tmp/requests",
      aiAdaptor: "claude",
      customCommands: [{ name: "deploy", description: "d", instruction: "i" }],
      customSuggestions: ["x-trace"],
      externalEventSocket: "/tmp/sock",
      version: VERSION,
    })
  })

  test("leaves aiAdaptor undefined when no ai is configured", async () => {
    const client = new InProcessRuntimeClient([], makeConfig())
    const dto = await client.getConfig()

    expect(dto.aiAdaptor).toBeUndefined()
    expect(dto.externalEventSocket).toBeUndefined()
  })
})

// A scriptable stand-in for an ACP adapter. run() resolves "ready" with no
// session id, keeping the test hermetic (the session-recording branch, which
// hits the embedded cache, is skipped). Tests drive the agent by invoking the
// callbacks the client wired into `options`.
class FakeAdapter implements AcpAdapterInstance {
  currentSessionId: string | undefined = undefined
  lastWrite: CodexAcpWriteInput | undefined
  stopped = false

  constructor(readonly options: CodexAcpAdapterOptions) {}

  async run(): Promise<unknown> {
    return this
  }

  async write(input: CodexAcpWriteInput): Promise<void> {
    this.lastWrite = input
  }

  stop(): void {
    this.stopped = true
  }
}

const makeAiClient = () => {
  let adapter: FakeAdapter | undefined
  const factory: AcpAdapterFactory = (_adaptor, options) => {
    adapter = new FakeAdapter(options)
    return adapter
  }
  const client = new InProcessRuntimeClient(
    [],
    makeConfig({ ai: "claude" }),
    factory,
  )
  return { client, getAdapter: () => adapter }
}

describe("InProcessRuntimeClient.ai orchestration", () => {
  test("start spawns an adapter and emits onSessionStarted when ready", async () => {
    const { client, getAdapter } = makeAiClient()
    const started: Array<{ resumed: boolean }> = []
    client.subscribe({ onSessionStarted: (e) => started.push(e) })

    await client.ai.start({ adaptor: "claude" })

    expect(getAdapter()).toBeDefined()
    expect(started).toEqual([{ sessionId: undefined, resumed: false }])
  })

  test("forwards adapter callbacks to the subscribed handlers", async () => {
    const { client, getAdapter } = makeAiClient()
    const updates: unknown[] = []
    const permissions: unknown[] = []
    const stopped: unknown[] = []
    client.subscribe({
      onSessionUpdate: (e) => updates.push(e),
      onPermissionRequest: (r) => permissions.push(r),
      onSessionStopped: (e) => stopped.push(e),
    })

    await client.ai.start({ adaptor: "claude" })
    const options = getAdapter()!.options

    options.onResponse?.({
      sessionId: "s",
      update: { sessionUpdate: "x" },
    } as unknown as CodexAcpResponse)
    options.onPermissionRequest?.({
      kind: "perm",
    } as unknown as CodexAcpPermissionRequest)
    options.onExit?.({ code: 0, signal: null })

    expect(updates).toEqual([
      { sessionId: "s", update: { sessionUpdate: "x" } },
    ])
    expect(permissions).toEqual([{ kind: "perm" }])
    expect(stopped).toEqual([{}])
  })

  test("prompt, respondPermission and stop reach the adapter", async () => {
    const { client, getAdapter } = makeAiClient()
    await client.ai.start({ adaptor: "claude" })

    await client.ai.prompt("hello", [{ name: "f.nts", path: "/root/f.nts" }])
    expect(getAdapter()!.lastWrite).toEqual({
      type: "prompt",
      text: "hello",
      refs: [{ name: "f.nts", path: "/root/f.nts" }],
    })

    await client.ai.respondPermission({ type: "selected", optionId: "opt-1" })
    expect(getAdapter()!.lastWrite).toEqual({
      type: "permission",
      decision: { type: "selected", optionId: "opt-1" },
    })

    client.ai.stop()
    expect(getAdapter()!.stopped).toBe(true)
  })

  test("a second start while one is live is a no-op (reuse)", async () => {
    const { client, getAdapter } = makeAiClient()
    await client.ai.start({ adaptor: "claude" })
    const first = getAdapter()

    await client.ai.start({ adaptor: "claude" })

    expect(getAdapter()).toBe(first)
  })
})

describe("toExecuteResult", () => {
  test("carries request fields, status, headers, body and timing", () => {
    const response = {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
      data: { error: "missing" },
      config: { method: "get", url: "/orders/9", baseURL: "https://api.test" },
    } as unknown as AxiosResponse

    expect(toExecuteResult(response, 42)).toEqual({
      request: {
        method: "get",
        url: "/orders/9",
        baseURL: "https://api.test",
      },
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
      body: { error: "missing" },
      durationMs: 42,
    })
  })
})
