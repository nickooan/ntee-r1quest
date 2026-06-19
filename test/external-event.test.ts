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
})
