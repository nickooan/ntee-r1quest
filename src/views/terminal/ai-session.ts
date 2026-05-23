import type {
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
