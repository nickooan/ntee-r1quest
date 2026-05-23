import type { Key } from "ink"
import { isAppExitCommand } from "./mode.ts"

export type AiChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiModeState = {
  input: string
  inputCursorX: number
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
    inputCursorX: 0,
    messages: [],
    scrollY: 0,
  }
}

const clampScrollY = (scrollY: number, maxScrollY = 0): number => {
  return Math.min(Math.max(scrollY, 0), Math.max(0, maxScrollY))
}

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
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

  if (key.leftArrow) {
    return {
      state: {
        ...state,
        inputCursorX: clampInputCursor(state.input, state.inputCursorX - 1),
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        inputCursorX: clampInputCursor(state.input, state.inputCursorX + 1),
      },
    }
  }

  if (key.backspace || key.delete) {
    const inputCursorX = clampInputCursor(state.input, state.inputCursorX)

    if (inputCursorX === 0) {
      return { state }
    }

    const input = `${state.input.slice(0, inputCursorX - 1)}${state.input.slice(
      inputCursorX,
    )}`

    return {
      state: {
        ...state,
        input,
        inputCursorX: inputCursorX - 1,
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
          inputCursorX: 0,
        },
      }
    }

    if (isAppExitCommand(trimmedInput)) {
      return {
        state: {
          ...state,
          input: "",
          inputCursorX: 0,
        },
        shouldExitApp: true,
      }
    }

    return {
      state: {
        input: "",
        inputCursorX: 0,
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
    const inputCursorX = clampInputCursor(state.input, state.inputCursorX)
    const nextInput = `${state.input.slice(0, inputCursorX)}${input}${state.input.slice(
      inputCursorX,
    )}`

    return {
      state: {
        ...state,
        input: nextInput,
        inputCursorX: inputCursorX + input.length,
      },
    }
  }

  return { state }
}
