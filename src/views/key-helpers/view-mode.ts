import type { Key } from "ink"
import {
  clampValue,
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"

export type ViewModeState = {
  command: string
  commandCursorX?: number
  scrollX: number
  scrollY: number
}

export type ViewModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewHeight: number
}

export type ViewModeResult = {
  state: ViewModeState
  selectedCommand?: string
  fileTreeSelectionDirection?: -1 | 1
  shouldMoveToParentDirectory?: boolean
}

const isEditModeShortcut = (input: string, key: Key): boolean => {
  return (key.ctrl && input.toLowerCase() === "e") || input === "\u0005"
}

export const handleViewModeInput = (
  input: string,
  key: Key,
  state: ViewModeState,
  limits?: ViewModeLimits,
): ViewModeResult => {
  if (key.shift && (key.upArrow || key.downArrow)) {
    return {
      state,
      fileTreeSelectionDirection: key.downArrow ? 1 : -1,
    }
  }

  if (limits && key.upArrow) {
    return {
      state: {
        ...state,
        scrollY: clampValue(state.scrollY - 1, 0, limits.maxScrollY),
      },
    }
  }

  if (limits && key.downArrow) {
    return {
      state: {
        ...state,
        scrollY: clampValue(state.scrollY + 1, 0, limits.maxScrollY),
      },
    }
  }

  if (key.shift && key.leftArrow) {
    return {
      state: {
        ...state,
        commandCursorX: moveInputCursor(
          state.command,
          state.commandCursorX ?? state.command.length,
          -1,
        ),
      },
    }
  }

  if (key.shift && key.rightArrow) {
    return {
      state: {
        ...state,
        commandCursorX: moveInputCursor(
          state.command,
          state.commandCursorX ?? state.command.length,
          1,
        ),
      },
    }
  }

  if (limits && key.leftArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(state.scrollX - 1, 0, limits.maxScrollX),
      },
    }
  }

  if (limits && key.rightArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(state.scrollX + 1, 0, limits.maxScrollX),
      },
    }
  }

  if (limits && key.pageUp) {
    return {
      state: {
        ...state,
        scrollY: clampValue(
          state.scrollY - limits.viewHeight,
          0,
          limits.maxScrollY,
        ),
      },
    }
  }

  if (limits && key.pageDown) {
    return {
      state: {
        ...state,
        scrollY: clampValue(
          state.scrollY + limits.viewHeight,
          0,
          limits.maxScrollY,
        ),
      },
    }
  }

  if (limits && key.home) {
    return {
      state: {
        ...state,
        scrollX: 0,
        scrollY: 0,
      },
    }
  }

  if (limits && key.end) {
    return {
      state: {
        ...state,
        scrollX: limits.maxScrollX,
        scrollY: limits.maxScrollY,
      },
    }
  }

  if (isEditModeShortcut(input, key)) {
    return {
      state,
      selectedCommand: "@edit",
    }
  }

  if (key.backspace || key.delete) {
    const nextCommand = removeInputBeforeCursor(
      state.command,
      state.commandCursorX ?? state.command.length,
    )

    if (!nextCommand) {
      return { state }
    }

    return {
      state: {
        ...state,
        command: nextCommand.input,
        commandCursorX: nextCommand.inputCursorX,
      },
    }
  }

  if (key.return) {
    return {
      state,
      selectedCommand: state.command,
    }
  }

  if (key.escape) {
    return {
      state,
      shouldMoveToParentDirectory: true,
    }
  }

  if (isTextInputIgnoredKey(key)) {
    return {
      state,
    }
  }

  if (input) {
    const nextCommand = insertInputAtCursor(
      state.command,
      state.commandCursorX ?? state.command.length,
      input,
    )

    return {
      state: {
        ...state,
        command: nextCommand.input,
        commandCursorX: nextCommand.inputCursorX,
      },
    }
  }

  return {
    state,
  }
}
