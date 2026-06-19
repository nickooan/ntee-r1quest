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

  test("labels the overlay with the chosen agent name", () => {
    const lines = buildVisibleAiMessageLines(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      12,
      50,
      0,
      0,
      false,
      "Claude",
    )
    const text = lines.map((line) => line.content).join("\n")

    expect(text).toContain("Claude Response")
    expect(text).toContain(":Claude")
    expect(text).toContain("Claude is thinking")
    expect(text).not.toContain("AI Response")
    expect(text).not.toContain(":AI")
  })

  test("defaults to the generic AI label when no name is given", () => {
    const lines = buildVisibleAiMessageLines([], 10, 40, 0, 0, true)

    expect(lines.some((line) => line.content.includes("AI is offline"))).toBe(
      true,
    )
  })
})
