import type { Key } from "ink"
import {
  clampValue,
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"

export type QueryModeState = {
  scrollX: number
  scrollY: number
  command: string
  commandCursorX?: number
}

export type QueryModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewHeight: number
}

export type QueryModeResult = {
  state: QueryModeState
  command?: string
  fileTreeSelectionDirection?: -1 | 1
  shouldMoveToParentDirectory?: boolean
}

export const clampQueryModeScroll = (
  state: QueryModeState,
  limits: QueryModeLimits,
): QueryModeState => {
  return {
    ...state,
    scrollX: clampValue(state.scrollX, 0, limits.maxScrollX),
    scrollY: clampValue(state.scrollY, 0, limits.maxScrollY),
  }
}

export const handleQueryModeInput = (
  input: string,
  key: Key,
  state: QueryModeState,
  limits: QueryModeLimits,
): QueryModeResult => {
  if (key.shift && (key.upArrow || key.downArrow)) {
    return {
      state,
      fileTreeSelectionDirection: key.downArrow ? 1 : -1,
    }
  }

  if (key.upArrow) {
    return {
      state: {
        ...state,
        scrollY: clampValue(state.scrollY - 1, 0, limits.maxScrollY),
      },
    }
  }

  if (key.downArrow) {
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

  if (key.leftArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(state.scrollX - 1, 0, limits.maxScrollX),
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(state.scrollX + 1, 0, limits.maxScrollX),
      },
    }
  }

  if (key.pageUp) {
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

  if (key.pageDown) {
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

  if (key.home) {
    return {
      state: {
        ...state,
        scrollX: 0,
        scrollY: 0,
      },
    }
  }

  if (key.end) {
    return {
      state: {
        ...state,
        scrollX: limits.maxScrollX,
        scrollY: limits.maxScrollY,
      },
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
      state: {
        ...state,
        command: "",
        commandCursorX: 0,
      },
      command: state.command,
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
