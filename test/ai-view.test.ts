import { describe, expect, test } from "@jest/globals"
import {
  buildAiMessageLines,
  buildVisibleAiMessageLines,
} from "../src/views/ai.tsx"

describe("ai view", () => {
  test("does not include full message content in render keys", () => {
    const content = "x".repeat(1000)
    const lines = buildAiMessageLines(
      [
        {
          role: "assistant",
          content,
        },
      ],
      20,
    )

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.some((line) => line.key.includes(content))).toBe(false)
  })

  test("shows when the AI process is offline", () => {
    const lines = buildVisibleAiMessageLines([], 10, 40, 0, 0, true)

    expect(lines).toContainEqual({
      key: "offline",
      role: "assistant",
      content: "AI is offline".padStart(40, " "),
    })
    expect(lines.some((line) => line.content.includes("AI is thinking"))).toBe(
      false,
    )
  })
})
