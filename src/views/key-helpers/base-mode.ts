import type { Key } from "ink"

export type BaseModeState = {
  scrollX: number
  scrollY: number
  command: string
}

export type BaseModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewHeight: number
}

export type BaseModeResult = {
  state: BaseModeState
  command?: string
  selectedSuggestionIndex?: number
}

export type BaseModeSuggestionState = {
  shouldShowSuggestions: boolean
  selectedSuggestionIndex: number
  suggestionCount: number
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

export const handleBaseModeInput = (
  input: string,
  key: Key,
  state: BaseModeState,
  limits: BaseModeLimits,
  suggestions?: BaseModeSuggestionState,
): BaseModeResult => {
  if (suggestions?.shouldShowSuggestions && key.upArrow) {
    return {
      state,
      selectedSuggestionIndex: clampValue(
        suggestions.selectedSuggestionIndex - 1,
        0,
        suggestions.suggestionCount - 1,
      ),
    }
  }

  if (suggestions?.shouldShowSuggestions && key.downArrow) {
    return {
      state,
      selectedSuggestionIndex: clampValue(
        suggestions.selectedSuggestionIndex + 1,
        0,
        suggestions.suggestionCount - 1,
      ),
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
    return {
      state: {
        ...state,
        command: state.command.slice(0, -1),
      },
    }
  }

  if (key.return) {
    return {
      state: {
        ...state,
        command: "",
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
    return {
      state: {
        ...state,
        command: `${state.command}${input}`,
      },
    }
  }

  return {
    state,
  }
}
