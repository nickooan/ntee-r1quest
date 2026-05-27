import { existsSync, statSync, unlinkSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { basename, join } from "node:path"

export type ExternalRequestEvent = {
  ntsPath: string
  ntsFile: string
  time: number
  responseContent: string
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

  return {
    ntsPath: value.ntsPath,
    ntsFile: value.ntsFile,
    time: value.time,
    responseContent: value.responseContent,
  }
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
