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
  ClaudeCodeAcpConversation,
  ClaudeCodeAcpPermissionRequest,
  ClaudeCodeAcpResponse,
} from "./claude-code-adapt.ts"

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

const { initClaudeCodeAcp } = await import("./claude-code-adapt.ts")

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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

describe("Claude Code ACP adapter integration", () => {
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

  test("starts the installed Claude ACP binary and creates a session", async () => {
    const claude = initClaudeCodeAcp({
      cwd: process.cwd(),
      args: ["--example"],
      env: {
        ANTHROPIC_API_KEY: "test-key",
      },
      clientName: "test-client",
      clientVersion: "1.2.3",
    })

    await claude.run()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining(
          "@agentclientprotocol/claude-agent-acp/dist/index.js",
        ),
        "--example",
      ],
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: "test-key",
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
    expect(claude.currentSessionId).toBe("session-1")
    expect(claude.isRunning).toBe(true)
  })

  test("sends user input as a prompt and forwards agent responses", async () => {
    const onResponse = jest.fn<(response: ClaudeCodeAcpResponse) => void>()
    const claude = initClaudeCodeAcp({
      onResponse,
    })

    promptMock.mockImplementation(async () => {
      const notification: SessionNotification = {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Hello from Claude",
          },
        },
      }

      await clientHandler?.sessionUpdate(notification)

      return {
        stopReason: "end_turn",
      } satisfies PromptResponse
    })

    await claude.run()
    await claude.write("  inspect this request  ")

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
          text: "Hello from Claude",
        },
      },
    })
  })

  test("sends new prompts while an earlier prompt is still running", async () => {
    const claude = initClaudeCodeAcp()
    const firstPrompt = createDeferred<PromptResponse>()

    promptMock.mockImplementationOnce(() => {
      return firstPrompt.promise
    })
    promptMock.mockResolvedValueOnce({
      stopReason: "end_turn",
    })

    await claude.run()
    const firstResult = claude.write("start a tunnel")
    await flushPromises()

    const secondResult = claude.write("what is the tunnel url?")
    await secondResult

    expect(promptMock).toHaveBeenCalledTimes(2)
    expect(promptMock).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      prompt: [
        {
          type: "text",
          text: "start a tunnel",
        },
      ],
    })
    expect(promptMock).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      prompt: [
        {
          type: "text",
          text: "what is the tunnel url?",
        },
      ],
    })

    firstPrompt.resolve({
      stopReason: "end_turn",
    })
    await firstResult
  })

  test("tracks unfinished prompt conversations", async () => {
    const onConversationUpdate =
      jest.fn<(conversation: ClaudeCodeAcpConversation) => void>()
    const claude = initClaudeCodeAcp({
      onConversationUpdate,
    })
    const firstPrompt = createDeferred<PromptResponse>()

    promptMock.mockImplementationOnce(() => {
      return firstPrompt.promise
    })

    await claude.run()
    const firstResult = claude.write("start a tunnel")
    await flushPromises()

    const [conversation] = claude.unfinishedPromptConversations
    const firstPromptRequest = promptMock.mock.calls[0]?.[0]

    expect(firstPromptRequest).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
      }),
    )
    expect(conversation).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        prompt: "start a tunnel",
        status: "pending",
        updates: [],
      }),
    )
    expect(onConversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: conversation?.id,
        status: "pending",
      }),
    )

    await clientHandler?.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Tunnel starting",
        },
      },
    })

    expect(claude.unfinishedPromptConversations[0]?.updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Tunnel starting",
        },
      },
    ])

    firstPrompt.resolve({
      stopReason: "end_turn",
    })
    await firstResult

    expect(claude.unfinishedPromptConversations).toEqual([])
    expect(claude.promptConversations[0]).toEqual(
      expect.objectContaining({
        id: conversation?.id,
        status: "completed",
        response: {
          stopReason: "end_turn",
        },
      }),
    )
  })

  test("resolves permission requests through write", async () => {
    const onPermissionRequest =
      jest.fn<(request: ClaudeCodeAcpPermissionRequest) => void>()
    const claude = initClaudeCodeAcp({
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

    await claude.run()
    const promptResult = claude.write("run a command")

    await flushPromises()

    expect(onPermissionRequest).toHaveBeenCalledWith(createPermissionRequest())
    expect(claude.currentPermissionRequest).toEqual(createPermissionRequest())

    await claude.write({
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
    expect(claude.currentPermissionRequest).toBeUndefined()
  })

  test("queues concurrent permission requests and resolves them in order", async () => {
    const onPermissionRequest =
      jest.fn<(request: ClaudeCodeAcpPermissionRequest) => void>()
    const claude = initClaudeCodeAcp({ onPermissionRequest })

    const base = createPermissionRequest()
    const requestA: RequestPermissionRequest = {
      ...base,
      toolCall: { toolCallId: "tool-a", title: "A", status: "pending" },
    }
    const requestB: RequestPermissionRequest = {
      ...base,
      toolCall: { toolCallId: "tool-b", title: "B", status: "pending" },
    }

    let responseA: RequestPermissionResponse | undefined
    let responseB: RequestPermissionResponse | undefined

    promptMock.mockImplementation(async () => {
      // Two permission requests issued concurrently within the same turn.
      const a = Promise.resolve(
        clientHandler?.requestPermission(requestA),
      ).then((response) => {
        responseA = response
      })
      const b = Promise.resolve(
        clientHandler?.requestPermission(requestB),
      ).then((response) => {
        responseB = response
      })

      await Promise.all([a, b])

      return { stopReason: "end_turn" } satisfies PromptResponse
    })

    await claude.run()
    const promptResult = claude.write("run two commands")

    await flushPromises()

    // Only the first request is surfaced and active; the second waits in queue.
    expect(onPermissionRequest).toHaveBeenCalledTimes(1)
    expect(claude.currentPermissionRequest).toEqual(requestA)

    // Answering the first surfaces the second.
    await claude.write({
      type: "permission",
      decision: { type: "selected", optionId: "approved" },
    })
    await flushPromises()

    expect(onPermissionRequest).toHaveBeenCalledTimes(2)
    expect(claude.currentPermissionRequest).toEqual(requestB)

    // Answering the second drains the queue and lets the turn complete.
    await claude.write({
      type: "permission",
      decision: { type: "selected", optionId: "denied" },
    })
    await promptResult

    expect(claude.currentPermissionRequest).toBeUndefined()
    expect(responseA).toEqual({
      outcome: { outcome: "selected", optionId: "approved" },
    })
    expect(responseB).toEqual({
      outcome: { outcome: "selected", optionId: "denied" },
    })
  })

  test("notifies when the Claude ACP process exits", async () => {
    const onExit =
      jest.fn<
        (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
      >()
    const childProcess = createMockProcess()

    spawnMock.mockReturnValue(childProcess)

    const claude = initClaudeCodeAcp({
      onExit,
    })

    await claude.run()

    childProcess.emit("exit", 0, null)

    expect(onExit).toHaveBeenCalledWith({
      code: 0,
      signal: null,
    })
  })
})
