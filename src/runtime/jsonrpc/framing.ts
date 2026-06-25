import { Buffer } from "node:buffer"
import type { JsonRpcMessage } from "./messages.ts"

// LSP-style framing: `Content-Length: N\r\n\r\n<utf8 json>`. Robust to any
// payload and byte-for-byte compatible with the Go reader/writer.

const HEADER_SEPARATOR = "\r\n\r\n"
const CONTENT_LENGTH_PREFIX = "content-length:"

export const encodeMessage = (message: JsonRpcMessage): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.from(
    `Content-Length: ${body.length}${HEADER_SEPARATOR}`,
    "ascii",
  )
  return Buffer.concat([header, body])
}

// Accumulates raw bytes off a stream and yields whole messages as complete
// frames arrive. One instance per connection; handles split and coalesced
// chunks.
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  append(chunk: Buffer): void {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
  }

  *drain(): Generator<JsonRpcMessage> {
    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR)
      if (headerEnd === -1) return

      const contentLength = parseContentLength(
        this.buffer.toString("ascii", 0, headerEnd),
      )
      if (contentLength === undefined) {
        throw new Error("JSON-RPC frame is missing a Content-Length header.")
      }

      const bodyStart = headerEnd + HEADER_SEPARATOR.length
      const bodyEnd = bodyStart + contentLength
      if (this.buffer.length < bodyEnd) return

      const body = this.buffer.toString("utf8", bodyStart, bodyEnd)
      this.buffer = this.buffer.subarray(bodyEnd)
      yield JSON.parse(body) as JsonRpcMessage
    }
  }
}

const parseContentLength = (header: string): number | undefined => {
  for (const line of header.split("\r\n")) {
    if (line.toLowerCase().startsWith(CONTENT_LENGTH_PREFIX)) {
      const value = Number.parseInt(
        line.slice(CONTENT_LENGTH_PREFIX.length).trim(),
        10,
      )
      if (Number.isFinite(value)) return value
    }
  }
  return undefined
}
