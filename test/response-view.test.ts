import { describe, expect, test } from "@jest/globals"
import {
  formatError,
  formatResponse,
  formatResponseBody,
  formatResponseHeaders,
  formatPending,
} from "../src/views/response.ts"
import { sectionRule } from "../src/views/terminal/section-format.ts"
import type { ExecuteResult } from "../src/runtime/client/types.ts"

const makeResult = (overrides: Partial<ExecuteResult> = {}): ExecuteResult => ({
  request: { method: "get", url: "https://ntee.io/x" },
  status: 200,
  statusText: "OK",
  headers: {},
  body: undefined,
  durationMs: 0,
  ...overrides,
})

describe("response view", () => {
  test("formats response headers as key value lines", () => {
    expect(
      formatResponseHeaders({
        "content-type": "application/json",
        "x-request-id": "abc-123",
      }),
    ).toBe("content-type: application/json\nx-request-id: abc-123")
  })

  test("formats object response bodies with indentation", () => {
    expect(
      formatResponseBody({
        content: [
          {
            name: "abc",
          },
          {
            name: "bcd",
            sub_arr: [1, 2, 3],
          },
        ],
      }),
    ).toBe(`{
  "content": [
    {
      "name": "abc"
    },
    {
      "name": "bcd",
      "sub_arr": [
        1,
        2,
        3
      ]
    }
  ]
}`)
  })

  test("keeps plain text bodies as-is", () => {
    expect(formatResponseBody("line 1\nline 2")).toBe("line 1\nline 2")
  })

  test("formats pending frames with animated dots", () => {
    expect(formatPending(0)).toBe("pending.")
    expect(formatPending(1)).toBe("pending..")
    expect(formatPending(2)).toBe("pending...")
    expect(formatPending(3)).toBe("pending.")
  })

  test("formats terminal error output", () => {
    expect(formatError(new Error("Unable to connect."))).toBe(
      `${sectionRule("Error", 60)}

Unable to connect.`,
    )
  })

  test("formats a non-2xx response with request and response details", () => {
    // Non-2xx is converted to an ExecuteResult upstream and rendered like any
    // other response (it no longer flows through formatError).
    const response = makeResult({
      request: {
        method: "get",
        url: "https://ntee.io/missing-resource?debug=true",
      },
      status: 404,
      statusText: "Not Found",
      headers: {
        "content-type": "application/json",
        "x-request-id": "error-123",
      },
      body: { message: "Not found" },
    })

    expect(formatResponse(response)).toBe(`/missing-resource [GET]
404 Not Found

${sectionRule("Request", 60)}
URL     https://ntee.io/missing-resource?debug=true
Method  GET

${sectionRule("Response", 60)}
Status  404 Not Found

Headers
  content-type: application/json
  x-request-id: error-123

Body
  {
    "message": "Not found"
  }`)
  })

  test("formats a full response with status headers and body", () => {
    const response = makeResult({
      request: { method: "get", url: "https://ntee.io/xxx/xx/xxx" },
      headers: {
        "content-type": "application/json",
        "x-request-id": "abc-123",
      },
      body: {
        content: [
          {
            name: "abc",
          },
        ],
      },
    })

    expect(formatResponse(response)).toBe(`/xxx/xx/xxx [GET]
200 OK

${sectionRule("Request", 60)}
URL     https://ntee.io/xxx/xx/xxx
Method  GET

${sectionRule("Response", 60)}
Status  200 OK

Headers
  content-type: application/json
  x-request-id: abc-123

Body
  {
    "content": [
      {
        "name": "abc"
      }
    ]
  }`)
  })

  test("adds the trace id below the status line when present", () => {
    const response = makeResult({
      request: { method: "get", url: "https://ntee.io/x" },
      headers: { "content-type": "application/json" },
      body: { ok: true },
    })

    // No trace id: the status section is just the status line.
    expect(formatResponse(response)).not.toContain("Trace:")

    const traced = formatResponse(response, "batch-42")

    // The trace id sits under the status line, above the Request section.
    expect(traced).toContain(`200 OK
Trace: batch-42

${sectionRule("Request", 60)}`)
  })

  test("formats a full text response with headers and multiline body", () => {
    const response = makeResult({
      request: { method: "post", url: "/text-response?line=2" },
      headers: {
        "content-type": "text/plain",
        "x-request-id": "text-123",
      },
      body: "line 1\nline 2",
    })

    expect(formatResponse(response)).toBe(`/text-response [POST]
200 OK

${sectionRule("Request", 60)}
URL     /text-response?line=2
Method  POST

${sectionRule("Response", 60)}
Status  200 OK

Headers
  content-type: text/plain
  x-request-id: text-123

Body
  line 1
  line 2`)
  })
})
