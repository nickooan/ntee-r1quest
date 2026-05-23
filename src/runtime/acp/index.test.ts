import { describe, expect, test } from "@jest/globals"
import {
  ClaudeCodeAcpAdapter,
  CodexAcpAdapter,
  getAdaptor,
  listAdaptors,
  resolveAdaptorName,
} from "./index.ts"

describe("ACP adaptor selector", () => {
  test("returns the Codex ACP adaptor constructor", () => {
    const Adaptor = getAdaptor("codex")

    expect(Adaptor).toBe(CodexAcpAdapter)
    expect(new Adaptor()).toBeInstanceOf(CodexAcpAdapter)
  })

  test("returns the Claude Code ACP adaptor constructor", () => {
    const Adaptor = getAdaptor("claude")

    expect(Adaptor).toBe(ClaudeCodeAcpAdapter)
    expect(new Adaptor()).toBeInstanceOf(ClaudeCodeAcpAdapter)
  })

  test("lists available adaptors", () => {
    expect(listAdaptors()).toEqual(["codex", "claude"])
  })

  test("normalizes and validates adaptor names", () => {
    expect(resolveAdaptorName(" Claude ")).toBe("claude")
    expect(() => {
      resolveAdaptorName("example")
    }).toThrow('ACP adaptor "example" is not supported.')
  })
})
