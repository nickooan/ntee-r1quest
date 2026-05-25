import { randomUUID } from "node:crypto"
import type { PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk"

export type AcpConversationStatus = "pending" | "completed" | "failed"

export type AcpConversation = {
  id: string
  sessionId: string
  prompt: string
  updates: SessionUpdate[]
  status: AcpConversationStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  response?: PromptResponse
  error?: unknown
  acknowledgedMessageId?: string
}

export type AcpConversationUpdateHandler = (
  conversation: AcpConversation,
) => void | Promise<void>

type AcpConversationManagerOptions = {
  onConversationUpdate?: AcpConversationUpdateHandler
  onError: (error: unknown) => void
}

export class AcpConversationManager {
  private readonly conversations = new Map<string, AcpConversation>()
  private readonly onConversationUpdate?: AcpConversationUpdateHandler
  private readonly onError: (error: unknown) => void
  private activeConversationId?: string

  constructor(options: AcpConversationManagerOptions) {
    this.onConversationUpdate = options.onConversationUpdate
    this.onError = options.onError
  }

  get promptConversations(): AcpConversation[] {
    return Array.from(this.conversations.values(), copyConversation)
  }

  get unfinishedPromptConversations(): AcpConversation[] {
    return this.promptConversations.filter((conversation) => {
      return conversation.status === "pending"
    })
  }

  resetActiveConversation(): void {
    this.activeConversationId = undefined
  }

  createConversation(sessionId: string, prompt: string): AcpConversation {
    const now = Date.now()
    const conversation: AcpConversation = {
      id: randomUUID(),
      sessionId,
      prompt,
      updates: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }

    this.conversations.set(conversation.id, conversation)
    this.activeConversationId = conversation.id
    this.emitConversationUpdate(conversation)

    return conversation
  }

  recordConversationUpdate(update: SessionUpdate): void {
    const conversation = this.findActiveConversation()

    if (!conversation) {
      return
    }

    conversation.updates = [...conversation.updates, update]
    conversation.updatedAt = Date.now()
    this.emitConversationUpdate(conversation)
  }

  completeConversation(id: string, response: PromptResponse): void {
    const conversation = this.conversations.get(id)

    if (!conversation) {
      return
    }

    const now = Date.now()
    conversation.status = "completed"
    conversation.response = response
    conversation.acknowledgedMessageId = response.userMessageId ?? undefined
    conversation.completedAt = now
    conversation.updatedAt = now

    if (this.activeConversationId === id) {
      this.activeConversationId = this.findLatestPendingConversationId()
    }

    this.emitConversationUpdate(conversation)
  }

  failConversation(id: string, error: unknown): void {
    const conversation = this.conversations.get(id)

    if (!conversation) {
      return
    }

    const now = Date.now()
    conversation.status = "failed"
    conversation.error = error
    conversation.completedAt = now
    conversation.updatedAt = now

    if (this.activeConversationId === id) {
      this.activeConversationId = this.findLatestPendingConversationId()
    }

    this.emitConversationUpdate(conversation)
  }

  private findActiveConversation(): AcpConversation | undefined {
    if (this.activeConversationId) {
      const conversation = this.conversations.get(this.activeConversationId)

      if (conversation?.status === "pending") {
        return conversation
      }
    }

    const id = this.findLatestPendingConversationId()

    return id ? this.conversations.get(id) : undefined
  }

  private findLatestPendingConversationId(): string | undefined {
    return Array.from(this.conversations.values())
      .filter((conversation) => {
        return conversation.status === "pending"
      })
      .sort((left, right) => right.createdAt - left.createdAt)[0]?.id
  }

  private emitConversationUpdate(conversation: AcpConversation): void {
    try {
      void Promise.resolve(
        this.onConversationUpdate?.(copyConversation(conversation)),
      ).catch((error: unknown) => {
        this.onError(error)
      })
    } catch (error) {
      this.onError(error)
    }
  }
}

const copyConversation = (conversation: AcpConversation): AcpConversation => {
  return {
    ...conversation,
    updates: [...conversation.updates],
  }
}
