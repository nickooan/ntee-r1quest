import { describe, expect, test } from "@jest/globals"
import { join } from "node:path"
import {
  buildFileTreeEntries,
  buildFileTreeViewport,
  buildExpandedDirectoryPaths,
  resolveSidebarCommand,
  resolveParentDirectoryCommand,
  findFileTreeMatchIndex,
  resolveHighlightedEntry,
  resolveNextFileTreeSelectionIndex,
} from "../src/runtime/file-manager/index.ts"
import { buildTerminalViewport } from "../src/views/terminal-app.tsx"
import {
  buildFilePaneLayout,
  buildGraphqlHighlightLines,
} from "../src/views/terminal/file-content.tsx"

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

  test("builds file content layout for the result pane", () => {
    expect(buildFilePaneLayout(40, 10, 120)).toEqual({
      contentWidth: 31,
      contentHeight: 8,
      lineNumberWidth: 3,
    })
  })

  test("detects multiline graphql query and mutation definition values", () => {
    expect([
      ...buildGraphqlHighlightLines([
        "query:",
        '"query GetPost($id: ID!) {',
        "  post(id: $id) {",
        "    title",
        "  }",
        '}"',
        "variables: {}",
        'mutation: "mutation CreatePost { createPost { id } }"',
      ]),
    ]).toEqual([1, 2, 3, 4, 5, 7])
  })

  test("builds a root file tree", () => {
    const root = join(process.cwd(), "test/data")

    expect(buildFileTreeEntries(root)).toContainEqual({
      name: "get.nts",
      relativePath: "get.nts",
      commandValue: "get",
      depth: 0,
      type: "request",
      isExpanded: false,
    })
  })

  test("builds nested file tree entries for expanded directories", () => {
    const root = join(process.cwd(), "test/data")

    expect(buildFileTreeEntries(root, new Set(["nested"]))).toContainEqual({
      name: "get.nts",
      relativePath: "nested/get.nts",
      commandValue: "nested/get",
      depth: 1,
      type: "request",
      isExpanded: false,
    })
  })

  test("expands only the directories for the current command path", () => {
    expect([...buildExpandedDirectoryPaths("nested/get")]).toEqual(["nested"])
    expect([...buildExpandedDirectoryPaths("nested/")]).toEqual(["nested"])
    expect([...buildExpandedDirectoryPaths("other")]).toEqual([])
  })

  test("keeps the selected sidebar command only while query input is empty or mode input", () => {
    expect(resolveSidebarCommand("", "nested/get")).toBe("nested/get")
    expect(resolveSidebarCommand("@s", "nested/get")).toBe("nested/get")
    expect(resolveSidebarCommand("get", "nested/get")).toBe("get")
  })

  test("resolves parent directory commands for folded view navigation", () => {
    expect(resolveParentDirectoryCommand("a/b/c/")).toBe("a/b/")
    expect(resolveParentDirectoryCommand("a/b/c")).toBe("a/b/")
    expect(resolveParentDirectoryCommand("a/")).toBe("")
    expect(resolveParentDirectoryCommand("")).toBeUndefined()
  })

  test("matches file tree entries from command input", () => {
    const root = join(process.cwd(), "test/data")
    const entries = buildFileTreeEntries(root, new Set(["nested"]))

    expect(entries[findFileTreeMatchIndex(entries, "nested/g")]).toMatchObject({
      commandValue: "nested/get",
    })
  })

  test("falls back to the closest parent directory highlight for unmatched child input", () => {
    const root = join(process.cwd(), "test/data")
    const entries = buildFileTreeEntries(root, new Set(["nested"]))

    expect(
      entries[resolveHighlightedEntry(entries, "nested/missing")],
    ).toMatchObject({
      commandValue: "nested/",
    })
  })

  test("prefers exact file tree matches before prefix matches", () => {
    const entries = [
      {
        name: "example-upload.nts",
        relativePath: "example-upload.nts",
        commandValue: "example-upload",
        depth: 0,
        type: "request" as const,
        isExpanded: false,
      },
      {
        name: "example.nts",
        relativePath: "example.nts",
        commandValue: "example",
        depth: 0,
        type: "request" as const,
        isExpanded: false,
      },
    ]

    expect(entries[findFileTreeMatchIndex(entries, "example")]).toMatchObject({
      commandValue: "example",
    })
    expect(
      entries[findFileTreeMatchIndex(entries, "example.nts")],
    ).toMatchObject({
      commandValue: "example",
    })
  })

  test("centers the highlighted file tree entry in the sidebar viewport", () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      name: `item-${index}`,
      relativePath: `item-${index}`,
      commandValue: `item-${index}`,
      depth: 0,
      type: "file" as const,
      isExpanded: false,
    }))
    const viewport = buildFileTreeViewport(entries, 5, 0, 10)

    expect(viewport.safeScrollY).toBe(8)
    expect(viewport.entries[2]?.name).toBe("item-10")
  })

  test("moves keyboard selection through file tree entries", () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
      name: `item-${index}`,
      relativePath: `item-${index}`,
      commandValue: `item-${index}`,
      depth: 0,
      type: "file" as const,
      isExpanded: false,
    }))

    expect(resolveNextFileTreeSelectionIndex(entries, -1, 1)).toBe(0)
    expect(resolveNextFileTreeSelectionIndex(entries, -1, -1)).toBe(2)
    expect(resolveNextFileTreeSelectionIndex(entries, 1, 1)).toBe(2)
    expect(resolveNextFileTreeSelectionIndex(entries, 1, -1)).toBe(0)
    expect(resolveNextFileTreeSelectionIndex(entries, 2, 1)).toBe(2)
    expect(resolveNextFileTreeSelectionIndex([], -1, 1)).toBe(-1)
  })
})
