import type { Key } from "ink"
import {
  clampValue,
  insertInputAtCursor,
  isTextInputIgnoredKey,
  moveInputCursor,
  removeInputBeforeCursor,
} from "./generic-key-actions.ts"

export type SearchMatch = {
  lineIndex: number
  start: number
  end: number
}

export type SearchModeState = {
  scrollX: number
  scrollY: number
  input: string
  inputCursorX?: number
  query: string
  focusedMatchIndex: number
}

export type SearchModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewWidth: number
  viewHeight: number
}

export type SearchModeResult = {
  state: SearchModeState
  submittedQuery?: string
}

const getHorizontalScrollStep = (viewWidth: number): number => {
  return Math.max(4, Math.floor(viewWidth / 4))
}

const searchMatchTopPadding = 2

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const createSearchRegex = (query: string): RegExp | null => {
  if (!query) {
    return null
  }

  try {
    return new RegExp(query, "gi")
  } catch {
    return new RegExp(escapeRegExp(query), "gi")
  }
}

export const findSearchMatches = (
  content: string,
  query: string,
): SearchMatch[] => {
  const regex = createSearchRegex(query)

  if (!regex) {
    return []
  }

  return content.split("\n").flatMap((line, lineIndex) => {
    const matches: SearchMatch[] = []

    for (const match of line.matchAll(regex)) {
      const matchedText = match[0]

      if (!matchedText) {
        continue
      }

      const start = match.index ?? 0

      matches.push({
        lineIndex,
        start,
        end: start + matchedText.length,
      })
    }

    return matches
  })
}

export const focusSearchMatch = (
  state: SearchModeState,
  limits: SearchModeLimits,
  matches: SearchMatch[],
  focusedMatchIndex: number,
): SearchModeState => {
  if (matches.length === 0) {
    return {
      ...state,
      focusedMatchIndex: 0,
      scrollY: clampValue(state.scrollY, 0, limits.maxScrollY),
    }
  }

  const safeFocusedMatchIndex = clampValue(
    focusedMatchIndex,
    0,
    matches.length - 1,
  )
  const focusedMatch = matches[safeFocusedMatchIndex]

  if (!focusedMatch) {
    return {
      ...state,
      focusedMatchIndex: 0,
      scrollY: clampValue(state.scrollY, 0, limits.maxScrollY),
    }
  }

  return {
    ...state,
    focusedMatchIndex: safeFocusedMatchIndex,
    scrollX: scrollXToSearchMatch(state.scrollX, limits, focusedMatch),
    scrollY: scrollYToSearchMatch(limits, focusedMatch),
  }
}

const scrollYToSearchMatch = (
  limits: SearchModeLimits,
  match: SearchMatch,
): number => {
  const topPadding = Math.min(
    searchMatchTopPadding,
    Math.max(0, limits.viewHeight - 1),
  )

  return clampValue(match.lineIndex - topPadding, 0, limits.maxScrollY)
}

const scrollXToSearchMatch = (
  scrollX: number,
  limits: SearchModeLimits,
  match: SearchMatch,
): number => {
  const safeScrollX = clampValue(scrollX, 0, limits.maxScrollX)
  const visibleEndColumnIndex = safeScrollX + limits.viewWidth

  if (match.start < safeScrollX || match.end > visibleEndColumnIndex) {
    const matchWidth = match.end - match.start
    const centeredScrollX =
      match.start - Math.floor((limits.viewWidth - matchWidth) / 2)

    return clampValue(centeredScrollX, 0, limits.maxScrollX)
  }

  return safeScrollX
}

export const handleSearchModeInput = (
  input: string,
  key: Key,
  state: SearchModeState,
  limits: SearchModeLimits,
  matches: SearchMatch[],
): SearchModeResult => {
  if (key.shift && key.leftArrow) {
    return {
      state: {
        ...state,
        inputCursorX: moveInputCursor(
          state.input,
          state.inputCursorX ?? state.input.length,
          -1,
        ),
      },
    }
  }

  if (key.shift && key.rightArrow) {
    return {
      state: {
        ...state,
        inputCursorX: moveInputCursor(
          state.input,
          state.inputCursorX ?? state.input.length,
          1,
        ),
      },
    }
  }

  if (key.leftArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(
          state.scrollX - getHorizontalScrollStep(limits.viewWidth),
          0,
          limits.maxScrollX,
        ),
      },
    }
  }

  if (key.rightArrow) {
    return {
      state: {
        ...state,
        scrollX: clampValue(
          state.scrollX + getHorizontalScrollStep(limits.viewWidth),
          0,
          limits.maxScrollX,
        ),
      },
    }
  }

  if (key.upArrow) {
    const nextFocusedMatchIndex =
      matches.length === 0
        ? 0
        : (state.focusedMatchIndex - 1 + matches.length) % matches.length

    return {
      state: focusSearchMatch(state, limits, matches, nextFocusedMatchIndex),
    }
  }

  if (key.downArrow) {
    const nextFocusedMatchIndex =
      matches.length === 0 ? 0 : (state.focusedMatchIndex + 1) % matches.length

    return {
      state: focusSearchMatch(state, limits, matches, nextFocusedMatchIndex),
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
        focusedMatchIndex: matches.length > 0 ? 0 : state.focusedMatchIndex,
      },
    }
  }

  if (key.end) {
    return {
      state: {
        ...state,
        scrollX: limits.maxScrollX,
        scrollY: limits.maxScrollY,
        focusedMatchIndex:
          matches.length > 0 ? matches.length - 1 : state.focusedMatchIndex,
      },
    }
  }

  if (key.backspace || key.delete) {
    const nextInput = removeInputBeforeCursor(
      state.input,
      state.inputCursorX ?? state.input.length,
    )

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
    return {
      state: {
        ...state,
        input: "",
        inputCursorX: 0,
        query: state.input,
        focusedMatchIndex: 0,
      },
      submittedQuery: state.input,
    }
  }

  if (isTextInputIgnoredKey(key) || key.escape) {
    return {
      state,
    }
  }

  if (input) {
    const nextInput = insertInputAtCursor(
      state.input,
      state.inputCursorX ?? state.input.length,
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

  return {
    state,
  }
}
