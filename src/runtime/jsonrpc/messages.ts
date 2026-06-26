// Hand-rolled JSON-RPC 2.0 message types shared by the runtime socket server and
// any TS client. Kept dependency-free and mirrored 1:1 by the Go package in
// `tui/internal/jsonrpc`. See docs/go-tui-migration-plan.md §4 / §4.1.

export type JsonRpcId = number | string

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result: unknown
}

export type JsonRpcFailure = {
  jsonrpc: "2.0"
  id: JsonRpcId
  error: JsonRpcErrorObject
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse

export type JsonRpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

// Reserved range (-32700..-32600) is for protocol-level errors; application
// errors use -32000 and below, discriminated by `data.kind` (plan §4).
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const

// Throw this from a handler to fail a request with a specific code/data. Any
// other thrown value is reported as InternalError.
export class RpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "RpcError"
    this.code = code
    this.data = data
  }

  toErrorObject(): JsonRpcErrorObject {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }
}

// A response carries no `method`; a request/notification always does.
export const isResponse = (
  message: JsonRpcMessage,
): message is JsonRpcResponse => !("method" in message)

export const isFailure = (
  response: JsonRpcResponse,
): response is JsonRpcFailure => "error" in response
