import { describe, expect, test } from "@jest/globals"
import { buildAiMessageLines } from "../src/views/ai.tsx"

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
})
