import type { Key } from "ink"

export type AiChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiModeState = {
  input: string
  messages: AiChatMessage[]
}

export type AiModeResult = {
  state: AiModeState
  shouldExitAi?: boolean
}

export const createAiModeState = (): AiModeState => {
  return {
    input: "",
    messages: [],
  }
}

export const handleAiModeInput = (
  input: string,
  key: Key,
  state: AiModeState,
): AiModeResult => {
  if (key.escape) {
    return {
      state,
      shouldExitAi: true,
    }
  }

  if (key.backspace || key.delete) {
    return {
      state: {
        ...state,
        input: state.input.slice(0, -1),
      },
    }
  }

  if (key.return) {
    const trimmedInput = state.input.trim()

    if (!trimmedInput) {
      return {
        state: {
          ...state,
          input: "",
        },
      }
    }

    return {
      state: {
        input: "",
        messages: [
          ...state.messages,
          {
            role: "user",
            content: trimmedInput,
          },
        ],
      },
    }
  }

  if (key.ctrl || key.meta || key.tab) {
    return { state }
  }

  if (input) {
    return {
      state: {
        ...state,
        input: `${state.input}${input}`,
      },
    }
  }

  return { state }
}
