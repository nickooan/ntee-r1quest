import type { Key } from "ink"
import {
  clampValue,
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"
import { resolveAppInputCommand } from "../../runtime/app-command/index.ts"
import {
  matchCustomCommands,
  resolveCustomCommandPrompt,
  type CustomCommand,
} from "../../runtime/custom-command/index.ts"

export type AiChatMessage = {
  // "divider" marks the boundary between replayed history and the live session;
  // its content is ignored and a fixed rule line is rendered instead.
  role: "user" | "assistant" | "divider"
  content: string
}

export type AiModeState = {
  input: string
  inputCursorX: number
  messages: AiChatMessage[]
  scrollY: number
  commandSuggestionIndex: number
}

export type AiModeLimits = {
  maxScrollY?: number
  customCommands?: CustomCommand[]
}

export type AiModeResult = {
  state: AiModeState
  submittedPrompt?: string
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
    commandSuggestionIndex: 0,
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

  const customCommands = limits.customCommands ?? []
  const suggestions = matchCustomCommands(customCommands, state.input)

  // While the suggestion popup is open, Tab/Enter accept the highlighted
  // command (inserting `/name ` so args can be typed, rather than submitting a
  // half-typed name), and the arrows move the highlight instead of scrolling.
  if (suggestions.length > 0) {
    const suggestionIndex = clampValue(
      state.commandSuggestionIndex,
      0,
      suggestions.length - 1,
    )

    if (key.tab || key.return) {
      const completion = `/${suggestions[suggestionIndex]?.name ?? ""} `

      return {
        state: {
          ...state,
          input: completion,
          inputCursorX: completion.length,
          commandSuggestionIndex: 0,
        },
      }
    }

    if (key.upArrow || key.downArrow) {
      const move = key.downArrow ? 1 : -1

      return {
        state: {
          ...state,
          commandSuggestionIndex:
            (suggestionIndex + move + suggestions.length) % suggestions.length,
        },
      }
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
        commandSuggestionIndex: 0,
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

    // A `/name args` slash command expands into its instruction; anything else
    // is sent verbatim. The expanded text is both shown in the chat and sent.
    const submittedPrompt =
      resolveCustomCommandPrompt(customCommands, trimmedInput) ?? trimmedInput

    return {
      state: {
        input: "",
        inputCursorX: 0,
        scrollY: 0,
        commandSuggestionIndex: 0,
        messages: [
          ...state.messages,
          {
            role: "user",
            content: submittedPrompt,
          },
        ],
      },
      submittedPrompt,
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
        commandSuggestionIndex: 0,
      },
    }
  }

  return { state }
}
