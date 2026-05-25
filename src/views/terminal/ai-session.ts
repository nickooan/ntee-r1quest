import type {
  CodexAcpConversation,
  CodexAcpPermissionRequest,
  CodexAcpResponse,
} from "../../runtime/acp/index.ts"
import type { AiModeState } from "../key-helpers/index.ts"

export const formatAcpPermissionMessage = (
  request: CodexAcpPermissionRequest,
): string => {
  return request.toolCall.title ?? "Allow AI agent action?"
}

export const findPermissionOptionId = (
  request: CodexAcpPermissionRequest,
  decision: "allow" | "reject",
): string | undefined => {
  const option = request.options.find((permissionOption) => {
    return decision === "allow"
      ? permissionOption.kind.startsWith("allow")
      : permissionOption.kind.startsWith("reject")
  })

  return option?.optionId
}

export const summarizeAiConversationActivity = (
  conversations: CodexAcpConversation[],
  now: number,
  idleAfterMs: number,
): {
  activeCount: number
  backgroundTaskCount: number
} => {
  const backgroundTerminalIds = new Set<string>()

  const summary = conversations
    .filter((conversation) => conversation.status === "pending")
    .reduce(
      (activitySummary, conversation) => {
        const toolActivity = recordBackgroundTerminalIds(
          conversation,
          backgroundTerminalIds,
        )
        const isIdle = now - conversation.updatedAt >= idleAfterMs
        const isLongRunningTool =
          toolActivity.hasToolActivity &&
          now - conversation.createdAt >= idleAfterMs

        if (isIdle || isLongRunningTool) {
          return {
            ...activitySummary,
            backgroundTaskCount:
              activitySummary.backgroundTaskCount +
              (toolActivity.hasBackgroundTerminal ? 0 : 1),
          }
        }

        return {
          ...activitySummary,
          activeCount: activitySummary.activeCount + 1,
        }
      },
      {
        activeCount: 0,
        backgroundTaskCount: 0,
      },
    )

  for (const conversation of conversations) {
    recordBackgroundTerminalIds(conversation, backgroundTerminalIds)
  }

  return {
    ...summary,
    backgroundTaskCount:
      summary.backgroundTaskCount + backgroundTerminalIds.size,
  }
}

const recordBackgroundTerminalIds = (
  conversation: CodexAcpConversation,
  terminalIds: Set<string>,
): {
  hasToolActivity: boolean
  hasBackgroundTerminal: boolean
} => {
  let hasToolActivity = false
  let hasBackgroundTerminal = false

  for (const update of conversation.updates) {
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update"
    ) {
      continue
    }

    hasToolActivity = true

    for (const content of update.content ?? []) {
      if (content.type === "terminal") {
        terminalIds.add(content.terminalId)
        hasBackgroundTerminal = true
      }
    }
  }

  return {
    hasToolActivity,
    hasBackgroundTerminal,
  }
}

const appendAssistantResponse = (
  state: AiModeState,
  content: string,
): AiModeState => {
  if (!content) {
    return state
  }

  const lastMessage = state.messages.at(-1)

  if (lastMessage?.role === "assistant") {
    return {
      ...state,
      scrollY: 0,
      messages: [
        ...state.messages.slice(0, -1),
        {
          role: "assistant",
          content: `${lastMessage.content}${content}`,
        },
      ],
    }
  }

  return {
    ...state,
    scrollY: 0,
    messages: [
      ...state.messages,
      {
        role: "assistant",
        content,
      },
    ],
  }
}

export const appendAcpResponse = (
  state: AiModeState,
  response: CodexAcpResponse,
): AiModeState => {
  const { update } = response

  if (
    update.sessionUpdate === "agent_message_chunk" &&
    update.content.type === "text"
  ) {
    return appendAssistantResponse(state, update.content.text)
  }

  if (update.sessionUpdate === "tool_call") {
    return appendAssistantResponse(state, `\n[${update.title}]`)
  }

  if (update.sessionUpdate === "tool_call_update" && update.title) {
    return appendAssistantResponse(state, `\n[${update.title}]`)
  }

  return state
}
