import { jest, describe, expect, test, beforeEach } from "@jest/globals"
import type { PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk"
import {
  AcpConversationManager,
  type AcpConversation,
} from "./conversation-manager.ts"

const onError = jest.fn<(error: unknown) => void>()
const onConversationUpdate =
  jest.fn<(conversation: AcpConversation) => void | Promise<void>>()

const createManager = () => {
  return new AcpConversationManager({
    onConversationUpdate,
    onError,
  })
}

const createMessageUpdate = (text: string): SessionUpdate => {
  return {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text,
    },
  }
}

const flushPromises = async () => {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

describe("AcpConversationManager", () => {
  beforeEach(() => {
    onError.mockReset()
    onConversationUpdate.mockReset()
  })

  test("creates pending conversations and emits isolated snapshots", () => {
    const manager = createManager()
    const conversation = manager.createConversation("session-1", "hello")

    expect(conversation).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        sessionId: "session-1",
        prompt: "hello",
        updates: [],
        status: "pending",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    )
    expect(manager.unfinishedPromptConversations).toEqual([
      expect.objectContaining({
        id: conversation.id,
        status: "pending",
      }),
    ])
    expect(onConversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: conversation.id,
        status: "pending",
      }),
    )

    const [snapshot] = manager.promptConversations
    snapshot?.updates.push(createMessageUpdate("mutated"))

    expect(manager.promptConversations[0]?.updates).toEqual([])
  })

  test("records updates on the active conversation", () => {
    const manager = createManager()
    const conversation = manager.createConversation("session-1", "hello")
    const update = createMessageUpdate("hi")

    manager.recordConversationUpdate(update)

    expect(manager.promptConversations).toEqual([
      expect.objectContaining({
        id: conversation.id,
        updates: [update],
        status: "pending",
      }),
    ])
    expect(onConversationUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: conversation.id,
        updates: [update],
      }),
    )
  })

  test("falls back to the latest pending conversation after completion", () => {
    const manager = createManager()
    const first = manager.createConversation("session-1", "first")
    const second = manager.createConversation("session-1", "second")
    const response: PromptResponse = {
      stopReason: "end_turn",
      userMessageId: second.id,
    }

    manager.completeConversation(second.id, response)
    manager.recordConversationUpdate(createMessageUpdate("still first"))

    expect(manager.promptConversations).toEqual([
      expect.objectContaining({
        id: first.id,
        updates: [createMessageUpdate("still first")],
        status: "pending",
      }),
      expect.objectContaining({
        id: second.id,
        status: "completed",
        response,
        acknowledgedMessageId: second.id,
        completedAt: expect.any(Number),
      }),
    ])
    expect(manager.unfinishedPromptConversations).toEqual([
      expect.objectContaining({
        id: first.id,
        status: "pending",
      }),
    ])
  })

  test("marks failed conversations and removes them from unfinished snapshots", () => {
    const manager = createManager()
    const conversation = manager.createConversation("session-1", "broken")
    const error = new Error("failed")

    manager.failConversation(conversation.id, error)

    expect(manager.unfinishedPromptConversations).toEqual([])
    expect(manager.promptConversations).toEqual([
      expect.objectContaining({
        id: conversation.id,
        status: "failed",
        error,
        completedAt: expect.any(Number),
      }),
    ])
  })

  test("ignores updates when there is no active pending conversation", () => {
    const manager = createManager()
    const conversation = manager.createConversation("session-1", "done")

    manager.completeConversation(conversation.id, {
      stopReason: "end_turn",
    })
    manager.recordConversationUpdate(createMessageUpdate("late"))

    expect(manager.promptConversations[0]?.updates).toEqual([])
  })

  test("resetActiveConversation still allows fallback to a pending conversation", () => {
    const manager = createManager()
    const conversation = manager.createConversation("session-1", "pending")
    const update = createMessageUpdate("after reset")

    manager.resetActiveConversation()
    manager.recordConversationUpdate(update)

    expect(manager.promptConversations[0]).toEqual(
      expect.objectContaining({
        id: conversation.id,
        updates: [update],
      }),
    )
  })

  test("reports synchronous and asynchronous update callback errors", async () => {
    const syncError = new Error("sync")
    onConversationUpdate.mockImplementationOnce(() => {
      throw syncError
    })

    createManager().createConversation("session-1", "sync error")

    expect(onError).toHaveBeenCalledWith(syncError)

    const asyncError = new Error("async")
    onConversationUpdate.mockImplementationOnce(() => {
      return Promise.reject(asyncError)
    })

    createManager().createConversation("session-1", "async error")
    await flushPromises()

    expect(onError).toHaveBeenCalledWith(asyncError)
  })
})
