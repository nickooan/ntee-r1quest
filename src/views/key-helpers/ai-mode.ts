import type { Key } from "ink"

export type AiChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiModeState = {
  input: string
  messages: AiChatMessage[]
  scrollY: number
}

export type AiModeLimits = {
  maxScrollY?: number
}

export type AiModeResult = {
  state: AiModeState
  shouldExitAi?: boolean
  shouldExitApp?: boolean
}

export const createAiModeState = (): AiModeState => {
  return {
    input: "",
    messages: [],
    scrollY: 0,
  }
}

const clampScrollY = (scrollY: number, maxScrollY = 0): number => {
  return Math.min(Math.max(scrollY, 0), Math.max(0, maxScrollY))
}

export const handleAiModeInput = (
  input: string,
  key: Key,
  state: AiModeState,
  limits: AiModeLimits = {},
): AiModeResult => {
  if (key.escape) {
    return {
      state,
      shouldExitAi: true,
    }
  }

  if (key.upArrow || key.downArrow) {
    return {
      state: {
        ...state,
        scrollY: clampScrollY(
          state.scrollY + (key.upArrow ? 1 : -1),
          limits.maxScrollY,
        ),
      },
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

    if (trimmedInput === "@exit" || trimmedInput === "@quit") {
      return {
        state: {
          ...state,
          input: "",
        },
        shouldExitApp: true,
      }
    }

    return {
      state: {
        input: "",
        scrollY: 0,
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
