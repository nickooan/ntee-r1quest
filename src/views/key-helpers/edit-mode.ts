import type { Key } from "ink"

export type EditSaveAction = "yes" | "no"

export type EditModeState = {
  lines: string[]
  cursorX: number
  cursorY: number
  input: string
  inputCursorX: number
  isSavePromptOpen: boolean
  selectedSaveAction: EditSaveAction
}

export type EditModeResult = {
  state: EditModeState
  shouldSave?: boolean
  shouldExitEdit?: boolean
}

export const createEditModeState = (content: string): EditModeState => {
  return {
    lines: content.split("\n"),
    cursorX: 0,
    cursorY: 0,
    input: "",
    inputCursorX: 0,
    isSavePromptOpen: false,
    selectedSaveAction: "yes",
  }
}

export const serializeEditModeContent = (state: EditModeState): string => {
  return state.lines.join("\n")
}

const clampCursor = (
  lines: string[],
  cursorX: number,
  cursorY: number,
): Pick<EditModeState, "cursorX" | "cursorY"> => {
  const safeCursorY = Math.min(
    Math.max(cursorY, 0),
    Math.max(0, lines.length - 1),
  )
  const targetLine = lines[safeCursorY] ?? ""

  return {
    cursorX: Math.min(Math.max(cursorX, 0), targetLine.length),
    cursorY: safeCursorY,
  }
}

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
}

const insertAtCursor = (state: EditModeState): EditModeState => {
  const lines = [...state.lines]
  const line = lines[state.cursorY] ?? ""
  const nextLine = `${line.slice(0, state.cursorX)}${state.input}${line.slice(
    state.cursorX,
  )}`

  lines[state.cursorY] = nextLine

  return {
    ...state,
    lines,
    cursorX: state.cursorX + state.input.length,
    input: "",
    inputCursorX: 0,
  }
}

const splitLineAtCursor = (state: EditModeState): EditModeState => {
  const lines = [...state.lines]
  const line = lines[state.cursorY] ?? ""
  const safeCursorX = Math.min(Math.max(state.cursorX, 0), line.length)

  if (safeCursorX === line.length) {
    lines.splice(state.cursorY + 1, 0, "")
  } else {
    lines[state.cursorY] = line.slice(0, safeCursorX)
    lines.splice(state.cursorY + 1, 0, line.slice(safeCursorX))
  }

  return {
    ...state,
    lines,
    cursorX: 0,
    cursorY: state.cursorY + 1,
  }
}

const removeBeforeCursor = (state: EditModeState): EditModeState => {
  const lines = [...state.lines]
  const line = lines[state.cursorY] ?? ""

  if (state.cursorX > 0) {
    lines[state.cursorY] = `${line.slice(0, state.cursorX - 1)}${line.slice(
      state.cursorX,
    )}`

    return {
      ...state,
      lines,
      cursorX: state.cursorX - 1,
    }
  }

  if (state.cursorY === 0) {
    return state
  }

  const previousLine = lines[state.cursorY - 1] ?? ""
  const nextCursorX = previousLine.length

  lines[state.cursorY - 1] = `${previousLine}${line}`
  lines.splice(state.cursorY, 1)

  return {
    ...state,
    lines,
    cursorX: nextCursorX,
    cursorY: state.cursorY - 1,
  }
}

const handleSavePromptInput = (
  key: Key,
  state: EditModeState,
): EditModeResult => {
  if (key.leftArrow || key.rightArrow) {
    return {
      state: {
        ...state,
        selectedSaveAction: state.selectedSaveAction === "yes" ? "no" : "yes",
      },
    }
  }

  if (key.return) {
    return {
      state: {
        ...state,
        isSavePromptOpen: false,
      },
      shouldSave: state.selectedSaveAction === "yes",
      shouldExitEdit: true,
    }
  }

  return { state }
}

export const handleEditModeInput = (
  input: string,
  key: Key,
  state: EditModeState,
): EditModeResult => {
  if (state.isSavePromptOpen) {
    return handleSavePromptInput(key, state)
  }

  if (key.escape) {
    return {
      state: {
        ...state,
        isSavePromptOpen: true,
        selectedSaveAction: "yes",
      },
    }
  }

  if (key.upArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX, state.cursorY - 1),
      },
    }
  }

  if (key.downArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX, state.cursorY + 1),
      },
    }
  }

  if (key.shift && key.leftArrow) {
    return {
      state: {
        ...state,
        inputCursorX: clampInputCursor(state.input, state.inputCursorX - 1),
      },
    }
  }

  if (key.shift && key.rightArrow) {
    return {
      state: {
        ...state,
        inputCursorX: clampInputCursor(state.input, state.inputCursorX + 1),
      },
    }
  }

  if (key.leftArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX - 1, state.cursorY),
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX + 1, state.cursorY),
      },
    }
  }

  if (key.backspace || key.delete) {
    if (state.input) {
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

    return {
      state: removeBeforeCursor(state),
    }
  }

  if (key.return) {
    return {
      state: state.input ? insertAtCursor(state) : splitLineAtCursor(state),
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
