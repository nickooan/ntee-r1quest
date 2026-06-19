import { describe, expect, test } from "@jest/globals"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import {
  shouldShowAiThinking,
  trackToolStatus,
} from "../src/views/terminal/ai-controller.ts"

describe("shouldShowAiThinking", () => {
  test("stays on before any reply has streamed", () => {
    expect(
      shouldShowAiThinking({
        hasStreamed: false,
        inProgressToolCount: 0,
        msSinceLastActivity: 60_000,
      }),
    ).toBe(true)
  })

  test("stays on while a tool call is still running, regardless of time", () => {
    // The background-task complaint: a long foreground task must not idle out.
    expect(
      shouldShowAiThinking({
        hasStreamed: true,
        inProgressToolCount: 1,
        msSinceLastActivity: 60_000,
      }),
    ).toBe(true)
  })

  test("stays on during recent streaming activity", () => {
    expect(
      shouldShowAiThinking({
        hasStreamed: true,
        inProgressToolCount: 0,
        msSinceLastActivity: 1_000,
      }),
    ).toBe(true)
  })

  test("goes idle once replied, no tools running, and quiet", () => {
    // The background-job case: tool completed, answer streamed, turn left open.
    expect(
      shouldShowAiThinking({
        hasStreamed: true,
        inProgressToolCount: 0,
        msSinceLastActivity: 5_000,
      }),
    ).toBe(false)
  })
})

describe("trackToolStatus", () => {
  const toolCall = (status: string): SessionUpdate =>
    ({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Terminal",
      status,
    }) as unknown as SessionUpdate

  const toolCallUpdate = (status?: string): SessionUpdate =>
    ({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      ...(status ? { status } : {}),
    }) as unknown as SessionUpdate

  test("adds a pending tool call and removes it when completed", () => {
    const inProgress = new Set<string>()

    trackToolStatus(inProgress, toolCall("pending"))
    expect(inProgress.size).toBe(1)

    // A background launch reports completed almost immediately.
    trackToolStatus(inProgress, toolCallUpdate("completed"))
    expect(inProgress.size).toBe(0)
  })

  test("keeps a long-running foreground tool in progress until it finishes", () => {
    const inProgress = new Set<string>()

    trackToolStatus(inProgress, toolCall("in_progress"))
    // Status-less updates (e.g. output chunks) do not clear it.
    trackToolStatus(inProgress, toolCallUpdate())
    expect(inProgress.size).toBe(1)

    trackToolStatus(inProgress, toolCallUpdate("failed"))
    expect(inProgress.size).toBe(0)
  })
})
