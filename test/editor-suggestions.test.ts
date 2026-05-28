import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "@jest/globals"
import {
  buildEditorSuggestionItems,
  buildRefSuggestionItems,
} from "../src/runtime/editor-suggestions/index.ts"

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
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        label: "content-type",
        insertText: "content-type, ",
        kind: "header",
      }),
    )
  })

  test("builds dynamic ref suggestions from the typed path fragment", async () => {
    const requestPath = resolve("test/data/post.nts")

    await expect(buildRefSuggestionItems(requestPath, ".")).resolves.toEqual([])
    await expect(
      buildRefSuggestionItems(requestPath, "user.ntd"),
    ).resolves.toEqual([])
    await expect(
      buildRefSuggestionItems(requestPath, "u"),
    ).resolves.toContainEqual(
      expect.objectContaining({
        label: "user.ntd",
        insertText: "user.ntd",
        kind: "ref",
      }),
    )
    await expect(
      buildRefSuggestionItems(requestPath, "n"),
    ).resolves.toContainEqual(
      expect.objectContaining({
        label: "nested/",
        insertText: "nested/",
        kind: "ref",
      }),
    )
  })
})
