// Exposes a RuntimeClient (the in-process facade) over a Unix-domain socket as
// bidirectional JSON-RPC: client→server method calls are dispatched to the
// wrapped client; the client's events are pushed back as notifications. This is
// the durable runtime-server half (plan §5, Phase C) — the Go TUI talks to it.

import { existsSync, statSync, unlinkSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import {
  JsonRpcConnection,
  JsonRpcErrorCode,
  RpcError,
} from "../jsonrpc/index.ts"
import { RpcEvent, RpcMethod, serializeError } from "./protocol.ts"
import type { RuntimeClient } from "./runtime-client.ts"
import type {
  AiPermissionDecision,
  AiStartRequest,
  ExecuteRequest,
} from "./types.ts"
import type { AcpAdaptorName } from "../acp/index.ts"

export class SocketRuntimeServer {
  private server: Server | undefined

  constructor(
    private readonly client: RuntimeClient,
    private readonly socketPath: string,
  ) {}

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.removeStaleSocket()

      const server = createServer((socket) => this.handleConnection(socket))

      server.once("error", reject)
      server.listen(this.socketPath, () => {
        server.removeListener("error", reject)
        resolve()
      })

      this.server = server
    })
  }

  close(): Promise<void> {
    this.client.close()

    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }

      this.server.close(() => {
        this.removeStaleSocket()
        resolve()
      })
    })
  }

  private handleConnection(socket: Socket): void {
    const connection = new JsonRpcConnection(socket, (method, params) =>
      this.dispatch(method, params),
    )

    // Forward every runtime event to this connection as a notification.
    const unsubscribe = this.client.subscribe({
      onSessionUpdate: (event) =>
        connection.notify(RpcEvent.SessionUpdate, event),
      onConversationUpdate: (conversation) =>
        connection.notify(RpcEvent.ConversationUpdate, conversation),
      onPermissionRequest: (request) =>
        connection.notify(RpcEvent.PermissionRequest, request),
      onSessionStarted: (event) =>
        connection.notify(RpcEvent.SessionStarted, event),
      onSessionStopped: (event) =>
        connection.notify(RpcEvent.SessionStopped, {
          error:
            event.error === undefined ? undefined : serializeError(event.error),
        }),
      onSessionError: (error) =>
        connection.notify(RpcEvent.SessionError, serializeError(error)),
      onExternalEvent: (event) =>
        connection.notify(RpcEvent.ExternalEvent, event),
      onError: (error) =>
        connection.notify(RpcEvent.Error, serializeError(error)),
    })

    socket.once("close", unsubscribe)
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case RpcMethod.GetConfig:
        return this.client.getConfig()
      case RpcMethod.Reload:
        return this.client.reload()
      case RpcMethod.Execute:
        return this.client.execute(params as ExecuteRequest)
      case RpcMethod.RecordInput:
        this.client.recordInput((params as { command: string }).command)
        return null
      case RpcMethod.ListAiSessions:
        return this.client.listAiSessions(
          (params as { adaptor: AcpAdaptorName }).adaptor,
        )
      case RpcMethod.ListApiEndpoints:
        return this.client.listApiEndpoints()
      case RpcMethod.ListTraceCalls:
        return this.client.listTraceCalls(
          (params as { traceId: string }).traceId,
        )
      case RpcMethod.ClearCache:
        await this.client.clearCache()
        return null
      case RpcMethod.AiStart:
        await this.client.ai.start(params as AiStartRequest)
        return null
      case RpcMethod.AiPrompt:
        await this.client.ai.prompt((params as { text: string }).text)
        return null
      case RpcMethod.AiRespondPermission:
        await this.client.ai.respondPermission(params as AiPermissionDecision)
        return null
      case RpcMethod.AiStop:
        this.client.ai.stop()
        return null
      default:
        throw new RpcError(
          JsonRpcErrorCode.MethodNotFound,
          `Unknown method: ${method}`,
        )
    }
  }

  private removeStaleSocket(): void {
    if (existsSync(this.socketPath) && statSync(this.socketPath).isSocket()) {
      unlinkSync(this.socketPath)
    }
  }
}
