import { describe, expect, test } from "@jest/globals"
import { appendAcpResponse } from "./ai-session.ts"
import { createAiModeState } from "../key-helpers/index.ts"
import type { CodexAcpResponse } from "../../runtime/acp/index.ts"

const textUpdate = (
  kind: "user_message_chunk" | "agent_message_chunk",
  text: string,
): CodexAcpResponse => ({
  sessionId: "session-1",
  update: {
    sessionUpdate: kind,
    content: { type: "text", text },
  },
})

describe("appendAcpResponse", () => {
  test("separates replayed turns by the user message between them", () => {
    let state = createAiModeState()

    state = appendAcpResponse(
      state,
      textUpdate("agent_message_chunk", "Hi! What would you like to work on?"),
    )
    state = appendAcpResponse(
      state,
      textUpdate("user_message_chunk", "what is my login email"),
    )
    state = appendAcpResponse(
      state,
      textUpdate(
        "agent_message_chunk",
        "Your login email is nickooan@gmail.com.",
      ),
    )

    expect(state.messages).toEqual([
      { role: "assistant", content: "Hi! What would you like to work on?" },
      { role: "user", content: "what is my login email" },
      { role: "assistant", content: "Your login email is nickooan@gmail.com." },
    ])
  })

  test("merges streamed chunks within a single assistant turn", () => {
    let state = createAiModeState()

    state = appendAcpResponse(state, textUpdate("agent_message_chunk", "Hel"))
    state = appendAcpResponse(state, textUpdate("agent_message_chunk", "lo"))

    expect(state.messages).toEqual([{ role: "assistant", content: "Hello" }])
  })

  test("ignores a user prompt echo already added locally in live mode", () => {
    let state = createAiModeState()

    // Live mode adds the user's message locally before the agent echoes it.
    state = { ...state, messages: [{ role: "user", content: "hello" }] }
    state = appendAcpResponse(state, textUpdate("user_message_chunk", "hello"))

    expect(state.messages).toEqual([{ role: "user", content: "hello" }])
  })
})
