import { existsSync, statSync, unlinkSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { basename, join } from "node:path"
import type { RecordApiCallInput } from "../cache/api.ts"

export type ExternalRequestEvent = {
  ntsPath: string
  ntsFile: string
  time: number
  responseContent: string
  // Batch/task id from the request's `-ti` flag. Present only when the request
  // was tagged with one.
  traceId?: string
  // Full API-call record for the receiving app to persist. The history store
  // is single-writer: while a terminal app is open it holds the store lock, so
  // a one-shot run cannot record directly — it hands the record over here and
  // the app (the lock holder) writes it. Absent on events from older senders.
  call?: RecordApiCallInput
}

export type ExternalEventListener = {
  close: () => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const assertExternalRequestEvent = (value: unknown): ExternalRequestEvent => {
  if (!isRecord(value)) {
    throw new TypeError("External event must be a JSON object.")
  }

  if (typeof value.ntsPath !== "string") {
    throw new TypeError("External event ntsPath must be a string.")
  }

  if (typeof value.ntsFile !== "string") {
    throw new TypeError("External event ntsFile must be a string.")
  }

  if (typeof value.time !== "number") {
    throw new TypeError("External event time must be a number.")
  }

  if (typeof value.responseContent !== "string") {
    throw new TypeError("External event responseContent must be a string.")
  }

  if (value.traceId !== undefined && typeof value.traceId !== "string") {
    throw new TypeError("External event traceId must be a string.")
  }

  const call =
    value.call === undefined ? undefined : assertCallRecord(value.call)

  return {
    ntsPath: value.ntsPath,
    ntsFile: value.ntsFile,
    time: value.time,
    responseContent: value.responseContent,
    ...(value.traceId === undefined ? {} : { traceId: value.traceId }),
    ...(call === undefined ? {} : { call }),
  }
}

const assertCallRecord = (value: unknown): RecordApiCallInput => {
  if (!isRecord(value)) {
    throw new TypeError("External event call must be a JSON object.")
  }

  if (typeof value.at !== "number" || typeof value.durationMs !== "number") {
    throw new TypeError("External event call.at/durationMs must be numbers.")
  }

  if (!isRecord(value.request) || !isRecord(value.response)) {
    throw new TypeError("External event call.request/response must be objects.")
  }

  if (typeof value.response.status !== "number") {
    throw new TypeError("External event call.response.status must be a number.")
  }

  return value as RecordApiCallInput
}

export const parseExternalRequestEvent = (
  input: string,
): ExternalRequestEvent => {
  return assertExternalRequestEvent(JSON.parse(input))
}

export const buildExternalEventCommand = (
  event: Pick<ExternalRequestEvent, "ntsPath" | "ntsFile">,
): string => {
  const fileName = event.ntsFile.endsWith(".nts")
    ? event.ntsFile.slice(0, -".nts".length)
    : event.ntsFile
  const normalizedPath = event.ntsPath.trim().replaceAll("\\", "/")
  const normalizedFileName = fileName.trim().replaceAll("\\", "/")

  return join(normalizedPath, normalizedFileName).replaceAll("\\", "/")
}

export const buildExternalRequestEvent = (
  requestPath: string,
  time: number,
  responseContent: string,
  traceId?: string,
  call?: RecordApiCallInput,
): ExternalRequestEvent => {
  const normalizedRequestPath = requestPath.trim().replaceAll("\\", "/")
  const ntsPath = normalizedRequestPath.includes("/")
    ? normalizedRequestPath.slice(0, normalizedRequestPath.lastIndexOf("/"))
    : ""
  const ntsFile = basename(normalizedRequestPath)

  return {
    ntsPath,
    ntsFile: ntsFile.endsWith(".nts") ? ntsFile : `${ntsFile}.nts`,
    time,
    responseContent,
    ...(traceId ? { traceId } : {}),
    ...(call ? { call } : {}),
  }
}

export const startExternalEventListener = (
  socketPath: string,
  onEvent: (event: ExternalRequestEvent) => void,
  onError: (error: unknown) => void,
): ExternalEventListener => {
  if (existsSync(socketPath)) {
    const existingSocket = statSync(socketPath)

    if (existingSocket.isSocket()) {
      unlinkSync(socketPath)
    }
  }

  const server = createServer((socket) => {
    let input = ""

    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      input += chunk
    })
    socket.on("error", onError)
    socket.on("end", () => {
      try {
        onEvent(parseExternalRequestEvent(input))
      } catch (error) {
        onError(error)
      }
    })
  })

  server.on("error", onError)
  server.listen(socketPath)

  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          if (existsSync(socketPath) && statSync(socketPath).isSocket()) {
            unlinkSync(socketPath)
          }

          resolve()
        })
      }),
  }
}

export const postExternalRequestEvent = async (
  socketPath: string,
  event: ExternalRequestEvent,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const client = createConnection(socketPath)

    client.on("error", reject)
    client.on("connect", () => {
      client.end(JSON.stringify(event))
    })
    client.on("close", () => {
      resolve()
    })
  })
}
