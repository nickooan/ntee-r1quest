import { describe, expect, test } from "@jest/globals"
import type { ApiCallRecord } from "../src/runtime/cache/index.ts"
import { formatHistoryEntry } from "../src/views/terminal/history-content.ts"

const record: ApiCallRecord = {
  endpoint: "/a/b/c [post]",
  path: "/a/b/c",
  method: "post",
  at: 0,
  durationMs: 42,
  request: {
    url: "https://api.example.com/a/b/c",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { name: "ada" },
  },
  response: {
    status: 201,
    headers: { "content-type": "application/json" },
    data: { id: 9 },
  },
}

describe("formatHistoryEntry", () => {
  test("renders summary, request and response sections", () => {
    const output = formatHistoryEntry(record, 40)

    // Title is the endpoint label; the HTTP method shows in the Request block.
    expect(output).toContain("/a/b/c [post]")
    expect(output).toContain("Method  POST")
    expect(output).toContain("201  ·  42 ms")
    expect(output).toContain("── Request ")
    expect(output).toContain("── Response ")
    expect(output).toContain("URL     https://api.example.com/a/b/c")
    // JSON bodies are pretty-printed and indented.
    expect(output).toContain('  "name": "ada"')
    expect(output).toContain('  "id": 9')
  })

  test("shows the trace id under the status line and above Request", () => {
    expect(formatHistoryEntry(record, 40)).not.toContain("Trace:")

    // The trace id sits directly under the status/duration line and above the
    // Request section rule.
    expect(
      formatHistoryEntry({ ...record, traceId: "batch-42" }, 40),
    ).toContain("201  ·  42 ms\nTrace: batch-42\n\n── Request ")
  })

  test("shows placeholders for empty headers and body", () => {
    const output = formatHistoryEntry(
      {
        ...record,
        request: { url: "http://h/x", method: "GET", headers: {} },
        response: { status: 204, headers: {}, data: undefined },
      },
      40,
    )

    expect(output).toContain("(none)")
    expect(output).toContain("(empty)")
  })
})
