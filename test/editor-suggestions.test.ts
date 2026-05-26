import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "@jest/globals"
import { buildEditorSuggestionItems } from "../src/runtime/editor-suggestions/index.ts"

describe("editor suggestions", () => {
  test("builds keyword, macro, and referenced definition suggestions", () => {
    const requestPath = resolve("test/data/post.nts")
    const suggestions = buildEditorSuggestionItems(
      requestPath,
      readFileSync(requestPath, "utf8"),
    )

    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "header", kind: "keyword" }),
    )
    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "@i", kind: "macro" }),
    )
    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "token", kind: "definition" }),
    )
    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "@i(token)", kind: "macro" }),
    )
  })
})
