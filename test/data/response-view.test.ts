import { describe, expect, test } from "bun:test"
import { AxiosError } from "axios"
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios"
import {
  formatError,
  formatResponse,
  formatResponseBody,
  formatResponseHeaders,
  formatPending,
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

  test("formats pending frames with animated dots", () => {
    expect(formatPending(0)).toBe("pending.")
    expect(formatPending(1)).toBe("pending..")
    expect(formatPending(2)).toBe("pending...")
    expect(formatPending(3)).toBe("pending.")
  })

  test("formats terminal error output", () => {
    expect(formatError(new Error("Unable to connect."))).toBe(
      `--------------- Error ---------------

Unable to connect.`,
    )
  })

  test("formats axios error output with response details only", () => {
    const config = {
      headers: {},
      method: "get",
      url: "https://ntee.io/missing-resource?debug=true",
    } as InternalAxiosRequestConfig
    const response: AxiosResponse = {
      config,
      status: 404,
      statusText: "Not Found",
      headers: {
        "content-type": "application/json",
        "x-request-id": "error-123",
      },
      data: {
        message: "Not found",
      },
      request: {},
    }
    const error = new AxiosError("Request failed", undefined, config, {}, response)

    expect(formatError(error)).toBe(`--------------- Response of get /missing-resource ---------------

404 Not Found

--------------- Headers ---------------

content-type: application/json
x-request-id: error-123

--------------- Body ---------------

{
  "message": "Not found"
}

--------------- End of get /missing-resource ---------------
`)
  })

  test("formats a full response with status headers and body", () => {
    const response: AxiosResponse = {
      config: {
        headers: {},
        method: "get",
        url: "https://ntee.io/xxx/xx/xxx",
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

    expect(formatResponse(response)).toBe(`--------------- Response of get /xxx/xx/xxx ---------------

200 OK

--------------- Headers ---------------

content-type: application/json
x-request-id: abc-123

--------------- Body ---------------

{
  "content": [
    {
      "name": "abc"
    }
  ]
}

--------------- End of get /xxx/xx/xxx ---------------
`)
  })

  test("formats a full text response with headers and multiline body", () => {
    const response: AxiosResponse = {
      config: {
        headers: {},
        method: "post",
        url: "/text-response?line=2",
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

    expect(formatResponse(response)).toBe(`--------------- Response of post /text-response ---------------

200 OK

--------------- Headers ---------------

content-type: text/plain
x-request-id: text-123

--------------- Body ---------------

line 1
line 2

--------------- End of post /text-response ---------------
`)
  })
})
