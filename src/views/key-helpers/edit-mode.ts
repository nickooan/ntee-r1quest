import type { Key } from "ink"
import type { EditorSuggestionItem } from "../../runtime/editor-suggestions/index.ts"
import {
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"

export type EditSaveAction = "yes" | "no"

export type EditSuggestionState = {
  options: EditorSuggestionItem[]
  selectedIndex: number
  replaceStart: number
  replaceEnd: number
}

export type EditRefSuggestionQuery = {
  fragment: string
}

export type EditModeState = {
  lines: string[]
  cursorX: number
  cursorY: number
  input: string
  inputCursorX: number
  isSavePromptOpen: boolean
  selectedSaveAction: EditSaveAction
  suggestions: EditSuggestionState | null
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
    suggestions: null,
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
    suggestions: null,
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
    input: "",
    inputCursorX: 0,
    suggestions: null,
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
      suggestions: null,
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
    suggestions: null,
  }
}

const isSpace = (character: string | undefined): boolean => {
  return character === undefined || /\s/.test(character)
}

const selectTokenAtCursor = (state: EditModeState): EditModeState => {
  const lines = [...state.lines]
  const line = lines[state.cursorY] ?? ""
  const cursorX = Math.min(Math.max(state.cursorX, 0), line.length)
  const leftCharacter = line[cursorX - 1]
  const rightCharacter = line[cursorX]

  if (isSpace(leftCharacter) && isSpace(rightCharacter)) {
    return {
      ...state,
      suggestions: null,
    }
  }

  let tokenStart = cursorX
  let tokenEnd = cursorX

  if (!isSpace(rightCharacter)) {
    tokenEnd = cursorX + 1

    while (tokenStart > 0 && !isSpace(line[tokenStart - 1])) {
      tokenStart -= 1
    }

    while (tokenEnd < line.length && !isSpace(line[tokenEnd])) {
      tokenEnd += 1
    }
  } else {
    tokenStart = cursorX - 1

    while (tokenStart > 0 && !isSpace(line[tokenStart - 1])) {
      tokenStart -= 1
    }

    while (tokenEnd < line.length && !isSpace(line[tokenEnd])) {
      tokenEnd += 1
    }
  }

  const token = line.slice(tokenStart, tokenEnd)

  lines[state.cursorY] = `${line.slice(0, tokenStart)}${line.slice(tokenEnd)}`

  return {
    ...state,
    lines,
    cursorX: tokenStart,
    input: token,
    inputCursorX: token.length,
    suggestions: null,
  }
}

const getEffectiveLine = (
  state: EditModeState,
): { line: string; cursorX: number } => {
  const line = state.lines[state.cursorY] ?? ""

  return {
    line: `${line.slice(0, state.cursorX)}${state.input}${line.slice(
      state.cursorX,
    )}`,
    cursorX: state.cursorX + state.inputCursorX,
  }
}

const isBodyKeySuggestionContext = (
  beforeCursor: string,
  replaceStart: number,
): boolean => {
  const beforePrefix = beforeCursor.slice(0, replaceStart)
  const trimmedBeforePrefix = beforePrefix.trimEnd()

  return (
    /(?:^|\s)body\s+\{[^}]*$/.test(beforePrefix) ||
    /[{,]\s*$/.test(trimmedBeforePrefix) ||
    /^\s+$/.test(beforePrefix)
  )
}

const findEditSuggestions = (
  state: EditModeState,
  suggestionItems: EditorSuggestionItem[],
): EditSuggestionState | null => {
  const { line, cursorX } = getEffectiveLine(state)
  const beforeCursor = line.slice(0, cursorX)
  const refMatch = beforeCursor.match(/^\s*ref\s+([^\s]*)$/)
  const headerMatch = beforeCursor.match(/^\s*header\s+([A-Za-z][A-Za-z-]*)$/)
  const definitionMatch = beforeCursor.match(/@i\(([A-Za-z0-9_-]*)$/)
  const macroMatch = beforeCursor.match(/@[A-Za-z]*$/)
  const keywordMatch = beforeCursor.match(/[A-Za-z][A-Za-z-]*$/)
  const bodyKeyMatch = beforeCursor.match(/[A-Za-z][A-Za-z0-9_-]*$/)

  if (refMatch?.[1] !== undefined) {
    const prefix = refMatch[1]

    if (
      !prefix ||
      prefix === "." ||
      prefix === ".." ||
      prefix === "/" ||
      prefix.endsWith(".ntd")
    ) {
      return null
    }

    const replaceStart = cursorX - prefix.length
    const options = suggestionItems.filter((item) => {
      return item.kind === "ref" && item.label.startsWith(prefix)
    })

    return options.length === 0
      ? null
      : {
          options,
          selectedIndex: 0,
          replaceStart,
          replaceEnd: cursorX,
        }
  }

  if (headerMatch?.[1] !== undefined) {
    const prefix = headerMatch[1]
    const replaceStart = cursorX - prefix.length
    const options = suggestionItems.filter((item) => {
      return item.kind === "header" && item.label.startsWith(prefix)
    })

    return options.length === 0
      ? null
      : {
          options,
          selectedIndex: 0,
          replaceStart,
          replaceEnd: cursorX,
        }
  }

  if (definitionMatch?.[1] !== undefined) {
    const prefix = definitionMatch[1]
    const replaceStart = cursorX - prefix.length
    const options = suggestionItems.filter((item) => {
      return item.kind === "definition" && item.label.startsWith(prefix)
    })

    return options.length === 0
      ? null
      : {
          options,
          selectedIndex: 0,
          replaceStart,
          replaceEnd: cursorX,
        }
  }

  if (macroMatch?.[0]) {
    const prefix = macroMatch[0]
    const replaceStart = cursorX - prefix.length
    const options = suggestionItems.filter((item) => {
      return item.kind === "macro" && item.label.startsWith(prefix)
    })

    return options.length === 0
      ? null
      : {
          options,
          selectedIndex: 0,
          replaceStart,
          replaceEnd: cursorX,
        }
  }

  if (bodyKeyMatch?.[0]) {
    const prefix = bodyKeyMatch[0]
    const replaceStart = cursorX - prefix.length

    if (isBodyKeySuggestionContext(beforeCursor, replaceStart)) {
      const options = suggestionItems.filter((item) => {
        return item.kind === "bodyKey" && item.label.startsWith(prefix)
      })

      return options.length === 0
        ? null
        : {
            options,
            selectedIndex: 0,
            replaceStart,
            replaceEnd: cursorX,
          }
    }
  }

  if (keywordMatch?.[0]) {
    const prefix = keywordMatch[0]
    const replaceStart = cursorX - prefix.length

    if (beforeCursor.slice(0, replaceStart).trim() !== "") {
      return null
    }

    const options = suggestionItems.filter((item) => {
      return item.kind === "keyword" && item.label.startsWith(prefix)
    })

    return options.length === 0
      ? null
      : {
          options,
          selectedIndex: 0,
          replaceStart,
          replaceEnd: cursorX,
        }
  }

  return null
}

export const getEditRefSuggestionQuery = (
  state: EditModeState,
): EditRefSuggestionQuery | null => {
  const { line, cursorX } = getEffectiveLine(state)
  const beforeCursor = line.slice(0, cursorX)
  const refMatch = beforeCursor.match(/^\s*ref\s+([^\s]*)$/)

  if (refMatch?.[1] === undefined) {
    return null
  }

  return {
    fragment: refMatch[1],
  }
}

const refreshSuggestions = (
  state: EditModeState,
  suggestionItems: EditorSuggestionItem[],
): EditModeState => {
  return {
    ...state,
    suggestions: findEditSuggestions(state, suggestionItems),
  }
}

export const refreshEditModeSuggestions = (
  state: EditModeState,
  suggestionItems: EditorSuggestionItem[],
): EditModeState => {
  return refreshSuggestions(state, suggestionItems)
}

const moveSuggestionSelection = (
  state: EditModeState,
  direction: -1 | 1,
): EditModeState => {
  if (!state.suggestions || state.suggestions.options.length === 0) {
    return state
  }

  const optionCount = state.suggestions.options.length

  return {
    ...state,
    suggestions: {
      ...state.suggestions,
      selectedIndex:
        (state.suggestions.selectedIndex + direction + optionCount) %
        optionCount,
    },
  }
}

const applySuggestion = (state: EditModeState): EditModeState => {
  const suggestions = state.suggestions

  if (!suggestions) {
    return state
  }

  const selectedOption = suggestions.options[suggestions.selectedIndex]

  if (!selectedOption) {
    return state
  }

  const { line } = getEffectiveLine(state)
  const nextLine = `${line.slice(0, suggestions.replaceStart)}${
    selectedOption.insertText
  }${line.slice(suggestions.replaceEnd)}`
  const nextCursorX =
    suggestions.replaceStart +
    (selectedOption.cursorOffset ?? selectedOption.insertText.length)
  const lines = [...state.lines]

  lines[state.cursorY] = nextLine

  return {
    ...state,
    lines,
    cursorX: nextCursorX,
    input: "",
    inputCursorX: 0,
    suggestions: null,
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

const isDirectSaveShortcut = (input: string, key: Key): boolean => {
  return (key.ctrl && input.toLowerCase() === "s") || input === "\u0013"
}

const isTokenSelectShortcut = (input: string, key: Key): boolean => {
  return (key.ctrl && input.toLowerCase() === "a") || input === "\u0001"
}

export const handleEditModeInput = (
  input: string,
  key: Key,
  state: EditModeState,
  suggestionItems: EditorSuggestionItem[] = [],
): EditModeResult => {
  if (state.isSavePromptOpen) {
    return handleSavePromptInput(key, state)
  }

  if (isDirectSaveShortcut(input, key)) {
    return {
      state: {
        ...state,
        isSavePromptOpen: false,
        selectedSaveAction: "yes",
        suggestions: null,
      },
      shouldSave: true,
      shouldExitEdit: true,
    }
  }

  if (isTokenSelectShortcut(input, key)) {
    return {
      state: selectTokenAtCursor(state),
    }
  }

  if (key.escape) {
    return {
      state: {
        ...state,
        isSavePromptOpen: true,
        selectedSaveAction: "yes",
        suggestions: null,
      },
    }
  }

  if ((key.upArrow || key.downArrow) && state.suggestions) {
    return {
      state: moveSuggestionSelection(state, key.downArrow ? 1 : -1),
    }
  }

  if (key.tab && !key.shift && state.suggestions) {
    return {
      state: applySuggestion(state),
    }
  }

  if (key.return && state.suggestions) {
    return {
      state: applySuggestion(state),
    }
  }

  if (key.upArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX, state.cursorY - 1),
        suggestions: null,
      },
    }
  }

  if (key.downArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX, state.cursorY + 1),
        suggestions: null,
      },
    }
  }

  if (key.shift && key.leftArrow) {
    return {
      state: {
        ...state,
        inputCursorX: moveInputCursor(state.input, state.inputCursorX, -1),
        suggestions: null,
      },
    }
  }

  if (key.shift && key.rightArrow) {
    return {
      state: {
        ...state,
        inputCursorX: moveInputCursor(state.input, state.inputCursorX, 1),
        suggestions: null,
      },
    }
  }

  if (key.leftArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX - 1, state.cursorY),
        suggestions: null,
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        ...clampCursor(state.lines, state.cursorX + 1, state.cursorY),
        suggestions: null,
      },
    }
  }

  if (key.backspace || key.delete) {
    if (state.input) {
      const nextInput = removeInputBeforeCursor(state.input, state.inputCursorX)

      if (!nextInput) {
        return { state }
      }

      return {
        state: refreshSuggestions(
          {
            ...state,
            input: nextInput.input,
            inputCursorX: nextInput.inputCursorX,
          },
          suggestionItems,
        ),
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
      state: refreshSuggestions(
        {
          ...state,
          input: nextInput.input,
          inputCursorX: nextInput.inputCursorX,
        },
        suggestionItems,
      ),
    }
  }

  return { state }
}
