import type { Key } from "ink"
import { clampValue } from "./base-mode.ts"

export type SearchMatch = {
  lineIndex: number
  start: number
  end: number
}

export type SearchModeState = {
  scrollX: number
  scrollY: number
  query: string
  focusedMatchIndex: number
}

export type SearchModeLimits = {
  maxScrollX: number
  maxScrollY: number
  viewHeight: number
}

export type SearchModeResult = {
  state: SearchModeState
  submittedQuery?: string
}

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

  const safeFocusedMatchIndex = clampValue(focusedMatchIndex, 0, matches.length - 1)
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
    scrollY: clampValue(focusedMatch.lineIndex, 0, limits.maxScrollY),
  }
}

export const handleSearchModeInput = (
  input: string,
  key: Key,
  state: SearchModeState,
  limits: SearchModeLimits,
  matches: SearchMatch[],
): SearchModeResult => {
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
        scrollY: clampValue(state.scrollY - limits.viewHeight, 0, limits.maxScrollY),
      },
    }
  }

  if (key.pageDown) {
    return {
      state: {
        ...state,
        scrollY: clampValue(state.scrollY + limits.viewHeight, 0, limits.maxScrollY),
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
    return {
      state: {
        ...state,
        query: state.query.slice(0, -1),
        focusedMatchIndex: 0,
      },
    }
  }

  if (key.return) {
    return {
      state,
      submittedQuery: state.query,
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
        query: `${state.query}${input}`,
        focusedMatchIndex: 0,
      },
    }
  }

  return {
    state,
  }
}
