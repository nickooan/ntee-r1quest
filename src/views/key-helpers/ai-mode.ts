import type { Key } from "ink"
import {
  clampValue,
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"
import { resolveAppInputCommand } from "../../runtime/app-command.ts"

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
  shouldReloadApp?: boolean
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
  return clampValue(scrollY, 0, Math.max(0, maxScrollY))
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
        inputCursorX: moveInputCursor(state.input, state.inputCursorX, -1),
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        inputCursorX: moveInputCursor(state.input, state.inputCursorX, 1),
      },
    }
  }

  if (key.backspace || key.delete) {
    const nextInput = removeInputBeforeCursor(state.input, state.inputCursorX)

    if (!nextInput) {
      return { state }
    }

    return {
      state: {
        ...state,
        input: nextInput.input,
        inputCursorX: nextInput.inputCursorX,
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

    const appCommand = resolveAppInputCommand(trimmedInput)

    if (appCommand.type === "app" && appCommand.command === "exit") {
      return {
        state: {
          ...state,
          input: "",
          inputCursorX: 0,
        },
        shouldExitApp: true,
      }
    }

    if (appCommand.type === "app" && appCommand.command === "reload") {
      return {
        state: {
          ...state,
          input: "",
          inputCursorX: 0,
        },
        shouldReloadApp: true,
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

  if (isTextInputIgnoredKey(key)) {
    return { state }
  }

  if (input) {
    const nextInput = insertInputAtCursor(
      state.input,
      state.inputCursorX,
      input,
    )

    return {
      state: {
        ...state,
        input: nextInput.input,
        inputCursorX: nextInput.inputCursorX,
      },
    }
  }

  return { state }
}
