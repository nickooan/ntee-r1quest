import { describe, expect, test } from "@jest/globals"
import { join } from "node:path"
import {
  buildRequestSuggestions,
  buildTerminalViewport,
} from "../src/views/terminal-app.tsx"

describe("terminal app view", () => {
  test("builds a fixed viewport from scroll offsets", () => {
    const viewport = buildTerminalViewport(
      "0123456789\nabcdefghij\nABCDEFGHIJ",
      4,
      2,
      3,
      1,
    )

    expect(viewport.lines).toEqual(["defg", "DEFG"])
    expect(viewport.maxScrollX).toBe(6)
    expect(viewport.maxScrollY).toBe(1)
  })

  test("pads short content to the fixed viewport height and width", () => {
    const viewport = buildTerminalViewport("ok", 4, 3, 0, 0)

    expect(viewport.lines).toEqual(["ok  ", "    ", "    "])
    expect(viewport.maxScrollX).toBe(0)
    expect(viewport.maxScrollY).toBe(0)
  })

  test("builds request suggestions from root request files", () => {
    const root = join(process.cwd(), "test/data")

    expect(buildRequestSuggestions(root, "g")).toEqual([
      {
        value: "get",
        label: "get",
        type: "request",
      },
    ])
  })

  test("builds nested request suggestions from directory input", () => {
    const root = join(process.cwd(), "test/data")

    expect(buildRequestSuggestions(root, "nested/g")).toEqual([
      {
        value: "nested/get",
        label: "nested/get",
        type: "request",
      },
    ])
  })
})
