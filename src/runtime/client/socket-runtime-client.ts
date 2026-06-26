// RuntimeClient implementation that talks to a SocketRuntimeServer over a
// Unix-domain socket via JSON-RPC. Drop-in replacement for InProcessRuntimeClient
// behind the same interface — proves the transport seam before any Go exists
// (plan §5, Phase C). The Go TUI is the production equivalent of this class.

import { createConnection, type Socket } from "node:net"
import { JsonRpcConnection } from "../jsonrpc/index.ts"
import {
  deserializeError,
  RpcEvent,
  RpcMethod,
  type SerializedError,
} from "./protocol.ts"
import type {
  AiClient,
  RuntimeClient,
  RuntimeEventHandlers,
} from "./runtime-client.ts"
import type {
  AiPermissionRequest,
  AiSessionStarted,
  AiSessionUpdate,
  ExecuteRequest,
  ExecuteResult,
  RuntimeConfigDto,
} from "./types.ts"
import type { AcpAdaptorName } from "../acp/index.ts"
import type { AiSessionRecord, ApiCallRecord } from "../cache/index.ts"
import type { ExternalRequestEvent } from "../external-event/index.ts"

export class SocketRuntimeClient implements RuntimeClient {
  private readonly connection: JsonRpcConnection
  private handlers: RuntimeEventHandlers = {}

  private constructor(private readonly socket: Socket) {
    this.connection = new JsonRpcConnection(socket, (method, params) =>
      this.handleEvent(method, params),
    )
  }

  static connect(socketPath: string): Promise<SocketRuntimeClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)

      socket.once("error", reject)
      socket.once("connect", () => {
        socket.removeListener("error", reject)
        resolve(new SocketRuntimeClient(socket))
      })
    })
  }

  getConfig(): Promise<RuntimeConfigDto> {
    return this.connection.request<RuntimeConfigDto>(RpcMethod.GetConfig)
  }

  reload(): Promise<RuntimeConfigDto> {
    return this.connection.request<RuntimeConfigDto>(RpcMethod.Reload)
  }

  execute(request: ExecuteRequest): Promise<ExecuteResult> {
    return this.connection.request<ExecuteResult>(RpcMethod.Execute, request)
  }

  recordInput(command: string): void {
    this.connection.notify(RpcMethod.RecordInput, { command })
  }

  listAiSessions(adaptor: AcpAdaptorName): Promise<AiSessionRecord[]> {
    return this.connection.request<AiSessionRecord[]>(
      RpcMethod.ListAiSessions,
      {
        adaptor,
      },
    )
  }

  listApiEndpoints(): Promise<ApiCallRecord[]> {
    return this.connection.request<ApiCallRecord[]>(RpcMethod.ListApiEndpoints)
  }

  listTraceCalls(traceId: string): Promise<ApiCallRecord[]> {
    return this.connection.request<ApiCallRecord[]>(RpcMethod.ListTraceCalls, {
      traceId,
    })
  }

  async clearCache(): Promise<void> {
    await this.connection.request(RpcMethod.ClearCache)
  }

  readonly ai: AiClient = {
    start: async (request) => {
      await this.connection.request(RpcMethod.AiStart, request)
    },
    prompt: async (text) => {
      await this.connection.request(RpcMethod.AiPrompt, { text })
    },
    respondPermission: async (decision) => {
      await this.connection.request(RpcMethod.AiRespondPermission, decision)
    },
    stop: () => {
      this.connection.notify(RpcMethod.AiStop)
    },
  }

  subscribe(handlers: RuntimeEventHandlers): () => void {
    this.handlers = handlers

    return () => {
      if (this.handlers === handlers) {
        this.handlers = {}
      }
    }
  }

  close(): void {
    this.connection.close()
  }

  // Routes server notifications to the subscribed handlers.
  private handleEvent(method: string, params: unknown): void {
    switch (method) {
      case RpcEvent.SessionUpdate:
        this.handlers.onSessionUpdate?.(params as AiSessionUpdate)
        return
      case RpcEvent.ConversationUpdate:
        this.handlers.onConversationUpdate?.(params)
        return
      case RpcEvent.PermissionRequest:
        this.handlers.onPermissionRequest?.(params as AiPermissionRequest)
        return
      case RpcEvent.SessionStarted:
        this.handlers.onSessionStarted?.(params as AiSessionStarted)
        return
      case RpcEvent.SessionStopped: {
        const { error } = params as { error?: SerializedError }
        this.handlers.onSessionStopped?.({
          error: error ? deserializeError(error) : undefined,
        })
        return
      }
      case RpcEvent.SessionError:
        this.handlers.onSessionError?.(
          deserializeError(params as SerializedError),
        )
        return
      case RpcEvent.ExternalEvent:
        this.handlers.onExternalEvent?.(params as ExternalRequestEvent)
        return
      case RpcEvent.Error:
        this.handlers.onError?.(deserializeError(params as SerializedError))
        return
    }
  }
}
