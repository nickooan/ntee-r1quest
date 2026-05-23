import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { jest, describe, expect, test, beforeEach } from "@jest/globals"
import type {
  Client,
  InitializeResponse,
  InitializeRequest,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import type {
  CodexAcpPermissionRequest,
  CodexAcpResponse,
} from "./codex-adapt.ts"

const spawnMock = jest.fn()
const initializeMock =
  jest.fn<(params: InitializeRequest) => Promise<InitializeResponse>>()
const newSessionMock =
  jest.fn<(params: NewSessionRequest) => Promise<NewSessionResponse>>()
const promptMock = jest.fn<(params: PromptRequest) => Promise<PromptResponse>>()
const ndJsonStreamMock = jest.fn()

let clientHandler: Client | undefined

class MockClientSideConnection {
  readonly closed = Promise.resolve()

  constructor(toClient: (agent: unknown) => Client, stream: unknown) {
    clientHandler = toClient({})
    expect(stream).toEqual({
      writable: "mock-writable",
      readable: "mock-readable",
    })
  }

  initialize(params: InitializeRequest) {
    return initializeMock(params)
  }

  newSession(params: NewSessionRequest) {
    return newSessionMock(params)
  }

  prompt(params: PromptRequest) {
    return promptMock(params)
  }
}

jest.unstable_mockModule("node:child_process", () => {
  return {
    spawn: spawnMock,
  }
})

jest.unstable_mockModule("@agentclientprotocol/sdk", () => {
  return {
    ClientSideConnection: MockClientSideConnection,
    PROTOCOL_VERSION: 1,
    ndJsonStream: ndJsonStreamMock,
  }
})

const { initCodexAcp } = await import("./codex-adapt.ts")

const createMockProcess = () => {
  const childProcess = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    kill: jest.Mock<() => boolean>
    once: EventEmitter["once"]
  }

  childProcess.stdin = new PassThrough()
  childProcess.stdout = new PassThrough()
  childProcess.stderr = new PassThrough()
  childProcess.killed = false
  childProcess.kill = jest.fn(() => {
    childProcess.killed = true
    childProcess.emit("exit", null, "SIGTERM")
    return true
  })

  return childProcess
}

const createPermissionRequest = (): RequestPermissionRequest => {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: "tool-1",
      title: "Run command",
      status: "pending",
    },
    options: [
      {
        optionId: "approved",
        name: "Approve",
        kind: "allow_once",
      },
      {
        optionId: "denied",
        name: "Deny",
        kind: "reject_once",
      },
    ],
  }
}

const flushPromises = async () => {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

describe("Codex ACP adapter integration", () => {
  beforeEach(() => {
    clientHandler = undefined
    spawnMock.mockReset()
    initializeMock.mockReset()
    newSessionMock.mockReset()
    promptMock.mockReset()
    ndJsonStreamMock.mockReset()

    spawnMock.mockReturnValue(createMockProcess())
    ndJsonStreamMock.mockReturnValue({
      writable: "mock-writable",
      readable: "mock-readable",
    })
    initializeMock.mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: {},
    })
    newSessionMock.mockResolvedValue({
      sessionId: "session-1",
    })
    promptMock.mockResolvedValue({
      stopReason: "end_turn",
    })
  })

  test("starts the installed Codex ACP binary and creates a session", async () => {
    const codex = initCodexAcp({
      cwd: process.cwd(),
      args: ["--example"],
      env: {
        OPENAI_API_KEY: "test-key",
      },
      clientName: "test-client",
      clientVersion: "1.2.3",
    })

    await codex.run()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining("@zed-industries/codex-acp/bin/codex-acp.js"),
        "--example",
      ],
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({
          OPENAI_API_KEY: "test-key",
        }),
        stdio: "pipe",
      }),
    )
    expect(initializeMock).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientInfo: {
        name: "test-client",
        version: "1.2.3",
      },
      clientCapabilities: {},
    })
    expect(newSessionMock).toHaveBeenCalledWith({
      cwd: process.cwd(),
      mcpServers: [],
    })
    expect(codex.currentSessionId).toBe("session-1")
    expect(codex.isRunning).toBe(true)
  })

  test("sends user input as a prompt and forwards agent responses", async () => {
    const onResponse = jest.fn<(response: CodexAcpResponse) => void>()
    const codex = initCodexAcp({
      onResponse,
    })

    promptMock.mockImplementation(async () => {
      const notification: SessionNotification = {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Hello from Codex",
          },
        },
      }

      await clientHandler?.sessionUpdate(notification)

      return {
        stopReason: "end_turn",
      } satisfies PromptResponse
    })

    await codex.run()
    await codex.write("  inspect this request  ")

    expect(promptMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      prompt: [
        {
          type: "text",
          text: "inspect this request",
        },
      ],
    })
    expect(onResponse).toHaveBeenCalledWith({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Hello from Codex",
        },
      },
    })
  })

  test("resolves permission requests through write", async () => {
    const onPermissionRequest =
      jest.fn<(request: CodexAcpPermissionRequest) => void>()
    const codex = initCodexAcp({
      onPermissionRequest,
    })
    let permissionResponse: RequestPermissionResponse | undefined

    promptMock.mockImplementation(async () => {
      permissionResponse = await clientHandler?.requestPermission(
        createPermissionRequest(),
      )

      return {
        stopReason: "end_turn",
      } satisfies PromptResponse
    })

    await codex.run()
    const promptResult = codex.write("run a command")

    await flushPromises()

    expect(onPermissionRequest).toHaveBeenCalledWith(createPermissionRequest())
    expect(codex.currentPermissionRequest).toEqual(createPermissionRequest())

    await codex.write({
      type: "permission",
      decision: {
        type: "selected",
        optionId: "approved",
      },
    })
    await promptResult

    expect(permissionResponse).toEqual({
      outcome: {
        outcome: "selected",
        optionId: "approved",
      },
    })
    expect(codex.currentPermissionRequest).toBeUndefined()
  })

  test("notifies when the Codex ACP process exits", async () => {
    const onExit =
      jest.fn<
        (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
      >()
    const childProcess = createMockProcess()

    spawnMock.mockReturnValue(childProcess)

    const codex = initCodexAcp({
      onExit,
    })

    await codex.run()

    childProcess.emit("exit", 0, null)

    expect(onExit).toHaveBeenCalledWith({
      code: 0,
      signal: null,
    })
  })
})
