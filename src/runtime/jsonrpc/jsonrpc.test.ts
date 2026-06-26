import { describe, expect, test } from "@jest/globals"
import { PassThrough, type Duplex } from "node:stream"
import { encodeMessage, FrameDecoder } from "./framing.ts"
import { JsonRpcConnection } from "./connection.ts"
import { JsonRpcErrorCode, RpcError } from "./messages.ts"

// Two cross-wired pipes form a loopback duplex pair: whatever endpoint A writes,
// endpoint B reads, and vice versa.
const createConnectedPair = (): [Duplex, Duplex] => {
  const aToB = new PassThrough()
  const bToA = new PassThrough()
  const makeEndpoint = (incoming: PassThrough, outgoing: PassThrough) =>
    ({
      on: (event: string, listener: (...args: unknown[]) => void) =>
        incoming.on(event, listener),
      write: (chunk: Buffer) => outgoing.write(chunk),
      end: () => outgoing.end(),
    }) as unknown as Duplex
  return [makeEndpoint(bToA, aToB), makeEndpoint(aToB, bToA)]
}

describe("FrameDecoder", () => {
  test("round-trips a single message", () => {
    const decoder = new FrameDecoder()
    decoder.append(encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" }))
    expect([...decoder.drain()]).toEqual([
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ])
  })

  test("reassembles a frame split across chunks", () => {
    const frame = encodeMessage({
      jsonrpc: "2.0",
      method: "note",
      params: { a: 1 },
    })
    const decoder = new FrameDecoder()
    decoder.append(frame.subarray(0, 6))
    expect([...decoder.drain()]).toEqual([])
    decoder.append(frame.subarray(6))
    expect([...decoder.drain()]).toEqual([
      { jsonrpc: "2.0", method: "note", params: { a: 1 } },
    ])
  })

  test("yields multiple coalesced frames", () => {
    const decoder = new FrameDecoder()
    decoder.append(
      Buffer.concat([
        encodeMessage({ jsonrpc: "2.0", id: 1, method: "a" }),
        encodeMessage({ jsonrpc: "2.0", id: 2, method: "b" }),
      ]),
    )
    expect([...decoder.drain()].map((m) => "method" in m && m.method)).toEqual([
      "a",
      "b",
    ])
  })
})

describe("JsonRpcConnection", () => {
  test("resolves a request with the handler's result", async () => {
    const [clientStream, serverStream] = createConnectedPair()
    new JsonRpcConnection(serverStream, (method, params) => {
      if (method !== "add") {
        throw new RpcError(JsonRpcErrorCode.MethodNotFound, method)
      }
      const [a, b] = params as [number, number]
      return a + b
    })
    const client = new JsonRpcConnection(clientStream)

    await expect(client.request("add", [2, 3])).resolves.toBe(5)
  })

  test("rejects with the RpcError thrown by the handler", async () => {
    const [clientStream, serverStream] = createConnectedPair()
    new JsonRpcConnection(serverStream, () => {
      throw new RpcError(JsonRpcErrorCode.InvalidParams, "bad", { kind: "x" })
    })
    const client = new JsonRpcConnection(clientStream)

    await expect(client.request("anything")).rejects.toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      message: "bad",
      data: { kind: "x" },
    })
  })

  test("delivers notifications without a response", async () => {
    const [clientStream, serverStream] = createConnectedPair()
    const received: unknown[] = []
    new JsonRpcConnection(serverStream, (method, params) => {
      if (method === "log") received.push(params)
    })
    const client = new JsonRpcConnection(clientStream)

    client.notify("log", { line: "hi" })
    await new Promise((resolve) => setImmediate(resolve))
    expect(received).toEqual([{ line: "hi" }])
  })

  test("works in both directions over one connection", async () => {
    const [clientStream, serverStream] = createConnectedPair()
    const client = new JsonRpcConnection(clientStream, (method) =>
      method === "ping" ? "pong" : undefined,
    )
    const server = new JsonRpcConnection(serverStream, (method) =>
      method === "hello" ? "world" : undefined,
    )

    await expect(server.request("ping")).resolves.toBe("pong")
    await expect(client.request("hello")).resolves.toBe("world")
  })
})
