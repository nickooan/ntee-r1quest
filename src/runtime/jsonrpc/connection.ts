import type { Duplex } from "node:stream"
import { encodeMessage, FrameDecoder } from "./framing.ts"
import {
  isFailure,
  isResponse,
  JsonRpcErrorCode,
  RpcError,
  type JsonRpcErrorObject,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./messages.ts"

// Handles one inbound request or notification. Return a value to answer a
// request; throw `RpcError` (or any error) to fail it. The return value is
// ignored for notifications. The same handler serves both directions, so a
// peer can act as client and server at once (bidirectional — plan §4).
export type RpcHandler = (
  method: string,
  params: unknown,
) => unknown | Promise<unknown>

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

// A full-duplex JSON-RPC 2.0 endpoint over any Node duplex stream (a UDS
// socket, a child process stdio pair, or an in-memory pipe in tests).
export class JsonRpcConnection {
  private readonly decoder = new FrameDecoder()
  private readonly pending = new Map<JsonRpcId, Pending>()
  private nextId = 1
  private handler: RpcHandler | undefined
  private closed = false

  constructor(
    private readonly stream: Duplex,
    handler?: RpcHandler,
  ) {
    this.handler = handler
    stream.on("data", (chunk: Buffer) => this.onData(chunk))
    stream.on("error", (error) => this.onClose(error))
    stream.on("close", () => this.onClose(new Error("Connection closed.")))
  }

  onRequest(handler: RpcHandler): void {
    this.handler = handler
  }

  request<Result = unknown>(method: string, params?: unknown): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      if (this.closed) {
        reject(
          new RpcError(JsonRpcErrorCode.InternalError, "Connection is closed."),
        )
        return
      }

      const id = this.nextId++
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.send({ jsonrpc: "2.0", method, params })
  }

  close(): void {
    this.onClose(new Error("Connection closed by caller."))
    this.stream.end()
  }

  private send(message: JsonRpcMessage): void {
    this.stream.write(encodeMessage(message))
  }

  private onData(chunk: Buffer): void {
    this.decoder.append(chunk)
    for (const message of this.decoder.drain()) {
      this.dispatch(message)
    }
  }

  private dispatch(message: JsonRpcMessage): void {
    if (isResponse(message)) {
      this.resolveResponse(message)
      return
    }

    if ("id" in message && message.id !== undefined) {
      void this.handleRequest(message)
    } else {
      void this.handleNotification(message.method, message.params)
    }
  }

  private resolveResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return

    this.pending.delete(response.id)
    if (isFailure(response)) {
      const { code, message, data } = response.error
      pending.reject(new RpcError(code, message, data))
    } else {
      pending.resolve(response.result)
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.invoke(request.method, request.params)
      this.send({ jsonrpc: "2.0", id: request.id, result: result ?? null })
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id: request.id,
        error: toErrorObject(error),
      })
    }
  }

  private async handleNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      await this.invoke(method, params)
    } catch {
      // Notifications have no response channel; swallow handler errors.
    }
  }

  private invoke(method: string, params: unknown): unknown | Promise<unknown> {
    if (!this.handler) {
      throw new RpcError(
        JsonRpcErrorCode.MethodNotFound,
        `No handler for "${method}".`,
      )
    }
    return this.handler(method, params)
  }

  private onClose(reason: unknown): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      pending.reject(reason)
    }
    this.pending.clear()
  }
}

const toErrorObject = (error: unknown): JsonRpcErrorObject => {
  if (error instanceof RpcError) return error.toErrorObject()
  const message = error instanceof Error ? error.message : String(error)
  return { code: JsonRpcErrorCode.InternalError, message }
}
