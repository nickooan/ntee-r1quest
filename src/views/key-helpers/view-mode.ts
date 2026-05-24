import type { Key } from "ink"

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
}

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
}

export const handleViewModeInput = (
  input: string,
  key: Key,
  state: ViewModeState,
  limits?: ViewModeLimits,
): ViewModeResult => {
  if (limits && key.upArrow) {
    return {
      state: {
        ...state,
        scrollY: Math.max(0, state.scrollY - 1),
      },
    }
  }

  if (limits && key.downArrow) {
    return {
      state: {
        ...state,
        scrollY: Math.min(limits.maxScrollY, state.scrollY + 1),
      },
    }
  }

  if (key.shift && key.leftArrow) {
    return {
      state: {
        ...state,
        commandCursorX: clampInputCursor(
          state.command,
          (state.commandCursorX ?? state.command.length) - 1,
        ),
      },
    }
  }

  if (key.shift && key.rightArrow) {
    return {
      state: {
        ...state,
        commandCursorX: clampInputCursor(
          state.command,
          (state.commandCursorX ?? state.command.length) + 1,
        ),
      },
    }
  }

  if (limits && key.leftArrow) {
    return {
      state: {
        ...state,
        scrollX: Math.max(0, state.scrollX - 1),
      },
    }
  }

  if (limits && key.rightArrow) {
    return {
      state: {
        ...state,
        scrollX: Math.min(limits.maxScrollX, state.scrollX + 1),
      },
    }
  }

  if (limits && key.pageUp) {
    return {
      state: {
        ...state,
        scrollY: Math.max(0, state.scrollY - limits.viewHeight),
      },
    }
  }

  if (limits && key.pageDown) {
    return {
      state: {
        ...state,
        scrollY: Math.min(limits.maxScrollY, state.scrollY + limits.viewHeight),
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

  if (key.backspace || key.delete) {
    const commandCursorX = clampInputCursor(
      state.command,
      state.commandCursorX ?? state.command.length,
    )

    if (commandCursorX === 0) {
      return { state }
    }

    const command = `${state.command.slice(0, commandCursorX - 1)}${state.command.slice(
      commandCursorX,
    )}`

    return {
      state: {
        ...state,
        command,
        commandCursorX: commandCursorX - 1,
      },
    }
  }

  if (key.return) {
    return {
      state,
      selectedCommand: state.command,
    }
  }

  if (key.ctrl || key.meta || key.escape || key.tab) {
    return {
      state,
    }
  }

  if (input) {
    const commandCursorX = clampInputCursor(
      state.command,
      state.commandCursorX ?? state.command.length,
    )
    const command = `${state.command.slice(0, commandCursorX)}${input}${state.command.slice(
      commandCursorX,
    )}`

    return {
      state: {
        ...state,
        command,
        commandCursorX: commandCursorX + input.length,
      },
    }
  }

  return {
    state,
  }
}
