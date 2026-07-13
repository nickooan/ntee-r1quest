import { describe, expect, test } from "@jest/globals"
import {
  buildExternalEventCommand,
  buildExternalRequestEvent,
  parseExternalRequestEvent,
} from "../src/runtime/external-event/index.ts"

describe("external event runtime", () => {
  test("parses external request events", () => {
    expect(
      parseExternalRequestEvent(
        JSON.stringify({
          ntsPath: "nested",
          ntsFile: "get.nts",
          time: 42,
          responseContent: "ok",
        }),
      ),
    ).toEqual({
      ntsPath: "nested",
      ntsFile: "get.nts",
      time: 42,
      responseContent: "ok",
    })
  })

  test("rejects invalid external request event fields", () => {
    expect(() => {
      parseExternalRequestEvent(
        JSON.stringify({
          ntsPath: "nested",
          ntsFile: "get.nts",
          time: "42",
          responseContent: "ok",
        }),
      )
    }).toThrow("External event time must be a number.")
  })

  test("builds sidebar command from event path and file", () => {
    expect(
      buildExternalEventCommand({
        ntsPath: "folder-1",
        ntsFile: "create-post.nts",
      }),
    ).toBe("folder-1/create-post")
  })

  test("builds event payloads from request paths with or without extension", () => {
    expect(buildExternalRequestEvent("nested/get", 12, "response")).toEqual({
      ntsPath: "nested",
      ntsFile: "get.nts",
      time: 12,
      responseContent: "response",
    })

    expect(buildExternalRequestEvent("get.nts", 12, "response")).toEqual({
      ntsPath: "",
      ntsFile: "get.nts",
      time: 12,
      responseContent: "response",
    })
  })

  test("carries an optional trace id through build and parse", () => {
    const event = buildExternalRequestEvent(
      "nested/get",
      12,
      "response",
      "batch-42",
    )

    expect(event).toEqual({
      ntsPath: "nested",
      ntsFile: "get.nts",
      time: 12,
      responseContent: "response",
      traceId: "batch-42",
    })

    expect(parseExternalRequestEvent(JSON.stringify(event))).toEqual(event)
  })

  test("rejects a non-string trace id", () => {
    expect(() => {
      parseExternalRequestEvent(
        JSON.stringify({
          ntsPath: "nested",
          ntsFile: "get.nts",
          time: 42,
          responseContent: "ok",
          traceId: 7,
        }),
      )
    }).toThrow("External event traceId must be a string.")
  })

  test("carries the intermediate flag through build and parse", () => {
    const event = buildExternalRequestEvent(
      "nested/get",
      12,
      "response",
      "joint-1",
      undefined,
      true,
    )

    expect(event.intermediate).toBe(true)
    expect(parseExternalRequestEvent(JSON.stringify(event)).intermediate).toBe(
      true,
    )
  })

  test("omits the intermediate flag on final and plain events", () => {
    expect(
      buildExternalRequestEvent("nested/get", 12, "response").intermediate,
    ).toBeUndefined()
    expect(
      buildExternalRequestEvent(
        "nested/get",
        12,
        "response",
        "t",
        undefined,
        false,
      ).intermediate,
    ).toBeUndefined()
  })

  test("rejects a non-boolean intermediate flag", () => {
    expect(() => {
      parseExternalRequestEvent(
        JSON.stringify({
          ntsPath: "nested",
          ntsFile: "get.nts",
          time: 42,
          responseContent: "ok",
          intermediate: "yes",
        }),
      )
    }).toThrow("External event intermediate must be a boolean.")
  })

  test("round-trips the full call record payload", () => {
    const call = {
      at: 1000,
      durationMs: 25,
      traceId: "T1",
      request: {
        url: "https://h/api/users",
        method: "get",
        headers: { accept: "application/json" },
      },
      response: { status: 200, headers: {}, data: { id: 1 } },
    }

    const event = buildExternalRequestEvent("nested/get", 42, "ok", "T1", call)

    expect(parseExternalRequestEvent(JSON.stringify(event)).call).toEqual(call)
  })

  test("parses events without a call payload (older senders)", () => {
    const event = buildExternalRequestEvent("nested/get", 42, "ok")

    expect(event.call).toBeUndefined()
    expect(
      parseExternalRequestEvent(JSON.stringify(event)).call,
    ).toBeUndefined()
  })

  test("rejects a malformed call payload", () => {
    expect(() => {
      parseExternalRequestEvent(
        JSON.stringify({
          ntsPath: "nested",
          ntsFile: "get.nts",
          time: 42,
          responseContent: "ok",
          call: { at: 1, durationMs: 2, request: {}, response: {} },
        }),
      )
    }).toThrow("External event call.response.status must be a number.")
  })
})
