import { describe, expect, test } from "@jest/globals"
import { buildPromptContent } from "./prompt-content.ts"

describe("buildPromptContent", () => {
  test("text only when there are no refs", () => {
    expect(buildPromptContent("hello")).toEqual([
      { type: "text", text: "hello" },
    ])
    expect(buildPromptContent("hello", [])).toEqual([
      { type: "text", text: "hello" },
    ])
  })

  test("appends a resource_link block per ref with a file:// uri", () => {
    const blocks = buildPromptContent("check [f.nts]", [
      { name: "f.nts", path: "/root/orders/f.nts" },
    ])
    expect(blocks).toEqual([
      { type: "text", text: "check [f.nts]" },
      {
        type: "resource_link",
        uri: "file:///root/orders/f.nts",
        name: "f.nts",
      },
    ])
  })

  test("encodes spaces in the path into the file uri", () => {
    const [, link] = buildPromptContent("x", [
      { name: "my file.nts", path: "/root/my file.nts" },
    ])
    expect(link).toEqual({
      type: "resource_link",
      uri: "file:///root/my%20file.nts",
      name: "my file.nts",
    })
  })
})
