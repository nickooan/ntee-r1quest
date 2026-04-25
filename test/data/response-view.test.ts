import { describe, expect, test } from "bun:test"
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios"
import {
  formatResponse,
  formatResponseBody,
  formatResponseHeaders,
} from "../../src/views/response.tsx"

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
    expect(formatResponseBody("line 1\nline 2", "text/plain")).toBe(
      "line 1\nline 2",
    )
  })

  test("formats a full response with status headers and body", () => {
    const response: AxiosResponse = {
      config: {
        headers: {},
      } as InternalAxiosRequestConfig,
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json",
        "x-request-id": "abc-123",
      },
      data: {
        content: [
          {
            name: "abc",
          },
        ],
      },
      request: {},
    }

    expect(formatResponse(response)).toBe(`200 OK

content-type: application/json
x-request-id: abc-123

{
  "content": [
    {
      "name": "abc"
    }
  ]
}`)
  })

  test("formats a full text response with headers and multiline body", () => {
    const response: AxiosResponse = {
      config: {
        headers: {},
      } as InternalAxiosRequestConfig,
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/plain",
        "x-request-id": "text-123",
      },
      data: "line 1\nline 2",
      request: {},
    }

    expect(formatResponse(response)).toBe(`200 OK

content-type: text/plain
x-request-id: text-123

line 1
line 2`)
  })
})
