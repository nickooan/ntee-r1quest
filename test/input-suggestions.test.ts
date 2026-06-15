import { describe, expect, jest, test } from "@jest/globals"
import type { FileTreeEntry } from "../src/runtime/file-manager/index.ts"

// Mock the cache so suggestions are deterministic and no LMDB store is touched.
jest.unstable_mockModule("../src/runtime/cache/index.ts", () => ({
  suggestInputs: (prefix: string) =>
    ["users/list-active", "users/list-archived"].filter((value) =>
      value.startsWith(prefix),
    ),
  recordInput: () => {},
  recordApiCall: () => {},
  clearCache: async () => {},
  listApiHistory: () => [],
}))

const { buildInputSuggestions, buildEndpointSuggestions } =
  await import("../src/views/terminal/input-suggestions.ts")

const entries: FileTreeEntry[] = [
  {
    name: "users",
    relativePath: "users",
    commandValue: "users/",
    depth: 0,
    type: "directory",
    isExpanded: true,
  },
  {
    name: "list.nts",
    relativePath: "users/list.nts",
    commandValue: "users/list",
    depth: 1,
    type: "request",
    isExpanded: false,
  },
  {
    name: "login.nts",
    relativePath: "users/login.nts",
    commandValue: "users/login",
    depth: 1,
    type: "request",
    isExpanded: false,
  },
]

describe("buildInputSuggestions", () => {
  test("mixes file/directory matches (first) with cached inputs", () => {
    const suggestions = buildInputSuggestions(entries, "users/l")

    expect(suggestions.map((item) => [item.source, item.label])).toEqual([
      ["file", "users/list"],
      ["file", "users/login"],
      ["cache", "users/list-active"],
      ["cache", "users/list-archived"],
    ])
  })

  test("orders the exact file match first", () => {
    const suggestions = buildInputSuggestions(entries, "users/list")

    expect(suggestions[0]).toMatchObject({
      source: "file",
      label: "users/list",
    })
    // Cached inputs that merely start with the text follow the exact match.
    expect(suggestions.slice(1).every((item) => item.source === "cache")).toBe(
      true,
    )
  })

  test("returns nothing for empty input or @ commands", () => {
    expect(buildInputSuggestions(entries, "")).toEqual([])
    expect(buildInputSuggestions(entries, "   ")).toEqual([])
    expect(buildInputSuggestions(entries, "@query")).toEqual([])
  })
})

describe("buildEndpointSuggestions", () => {
  const labels = ["/a/b/c [get]", "/a/b/c [post]", "/x/y [get]"]

  test("returns both methods of a matching endpoint path", () => {
    expect(buildEndpointSuggestions(labels, "/a/b/c")).toEqual([
      { label: "/a/b/c [get]", insertText: "/a/b/c [get]", source: "endpoint" },
      {
        label: "/a/b/c [post]",
        insertText: "/a/b/c [post]",
        source: "endpoint",
      },
    ])
  })

  test("returns nothing for empty input or @ commands", () => {
    expect(buildEndpointSuggestions(labels, "")).toEqual([])
    expect(buildEndpointSuggestions(labels, "@h")).toEqual([])
  })
})
