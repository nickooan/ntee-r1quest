import type { Key } from "ink"

export type BaseModeState = {
  scrollX: number
  scrollY: number
  command: string
  commandCursorX?: number
}

export type BaseModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewHeight: number
}

export type BaseModeResult = {
  state: BaseModeState
  command?: string
}

export const clampValue = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

export const clampBaseModeScroll = (
  state: BaseModeState,
  limits: BaseModeLimits,
): BaseModeState => {
  return {
    ...state,
    scrollX: clampValue(state.scrollX, 0, limits.maxScrollX),
    scrollY: clampValue(state.scrollY, 0, limits.maxScrollY),
  }
}

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
}

export const handleBaseModeInput = (
  input: string,
  key: Key,
  state: BaseModeState,
  limits: BaseModeLimits,
): BaseModeResult => {
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
      state: {
        ...state,
        command: "",
        commandCursorX: 0,
      },
      command: state.command,
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
