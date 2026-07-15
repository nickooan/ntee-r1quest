import { afterAll, beforeAll, describe, expect, test } from "@jest/globals"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InProcessRuntimeClient } from "./inprocess-runtime-client.ts"
import type { AcpAdapterInstance } from "./inprocess-runtime-client.ts"
import { SocketRuntimeServer } from "./socket-runtime-server.ts"
import { SocketRuntimeClient } from "./socket-runtime-client.ts"
import type { RuntimeConfig } from "../config.ts"
import type {
  CodexAcpAdapterOptions,
  CodexAcpResponse,
  CodexAcpWriteInput,
} from "../acp/index.ts"

const makeConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  root: "/tmp/requests",
  customSuggestions: [],
  customCommands: [],
  sessionCleanupPeriod: 7,
  parsedArgs: {},
  ...overrides,
})

// Same scriptable adapter shape as the in-process tests; run() stays hermetic
// (no session id → no cache writes).
class FakeAdapter implements AcpAdapterInstance {
  currentSessionId: string | undefined = undefined
  lastWrite: CodexAcpWriteInput | undefined
  readonly supportsMidTurnPrompts = false

  constructor(readonly options: CodexAcpAdapterOptions) {}

  async run(): Promise<unknown> {
    return this
  }

  async write(input: CodexAcpWriteInput): Promise<void> {
    this.lastWrite = input
  }

  stop(): void {}
}

describe("socket runtime (end-to-end over a real UDS)", () => {
  const socketPath = join(tmpdir(), `r1q-sock-${process.pid}.sock`)
  let adapter: FakeAdapter | undefined
  let server: SocketRuntimeServer
  let client: SocketRuntimeClient

  beforeAll(async () => {
    const inproc = new InProcessRuntimeClient(
      [],
      makeConfig({ ai: "claude" }),
      (_adaptor, options) => {
        adapter = new FakeAdapter(options)
        return adapter
      },
    )
    server = new SocketRuntimeServer(inproc, socketPath)
    await server.listen()
    client = await SocketRuntimeClient.connect(socketPath)
  })

  afterAll(async () => {
    client.close()
    await server.close()
  })

  test("getConfig round-trips a request/response over the socket", async () => {
    await expect(client.getConfig()).resolves.toMatchObject({
      root: "/tmp/requests",
      aiAdaptor: "claude",
    })
  })

  test("ai.start streams an onSessionStarted notification back", async () => {
    const started = new Promise((resolve) =>
      client.subscribe({ onSessionStarted: resolve }),
    )

    await client.ai.start({ adaptor: "claude" })

    await expect(started).resolves.toEqual({
      sessionId: undefined,
      resumed: false,
      supportsSteering: false,
    })
  })

  test("an adapter response is forwarded as an onSessionUpdate notification", async () => {
    const update = new Promise((resolve) =>
      client.subscribe({ onSessionUpdate: resolve }),
    )

    adapter!.options.onResponse?.({
      sessionId: "s",
      update: { sessionUpdate: "x" },
    } as unknown as CodexAcpResponse)

    await expect(update).resolves.toEqual({
      sessionId: "s",
      update: { sessionUpdate: "x" },
    })
  })

  test("ai.prompt reaches the adapter through the server", async () => {
    await client.ai.prompt("hello over the wire")
    expect(adapter!.lastWrite).toEqual({
      type: "prompt",
      text: "hello over the wire",
    })
  })

  test("recordInput is a fire-and-forget notification", () => {
    expect(() => client.recordInput("folder/get")).not.toThrow()
  })
})
