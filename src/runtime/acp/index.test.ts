import { describe, expect, test } from "@jest/globals"
import { CodexAcpAdapter, getAdaptor, listAdaptors } from "./index.ts"

describe("ACP adaptor selector", () => {
  test("returns the Codex ACP adaptor constructor", () => {
    const Adaptor = getAdaptor("codex")

    expect(Adaptor).toBe(CodexAcpAdapter)
    expect(new Adaptor()).toBeInstanceOf(CodexAcpAdapter)
  })

  test("lists available adaptors", () => {
    expect(listAdaptors()).toEqual(["codex"])
  })
})
