import { describe, expect, test } from "bun:test"
import type { Key } from "ink"
import {
  findSearchMatches,
  handleBaseModeInput,
  handleSearchModeInput,
  type BaseModeLimits,
  type BaseModeState,
  type SearchModeState,
} from "../src/views/key-helpers/index.ts"

const defaultKey: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
}

const state: BaseModeState = {
  scrollX: 2,
  scrollY: 3,
  command: "get",
}

const limits: BaseModeLimits = {
  maxScrollX: 5,
  maxScrollY: 10,
  viewHeight: 4,
}

const searchLimits = {
  ...limits,
  viewWidth: 4,
}

const key = (keyValues: Partial<Key>): Key => {
  return {
    ...defaultKey,
    ...keyValues,
  }
}

describe("base mode key helpers", () => {
  test("handles vertical and horizontal scroll keys", () => {
    expect(handleBaseModeInput("", key({ upArrow: true }), state, limits).state).toEqual({
      ...state,
      scrollY: 2,
    })
    expect(
      handleBaseModeInput("", key({ downArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 4,
    })
    expect(
      handleBaseModeInput("", key({ leftArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 1,
    })
    expect(
      handleBaseModeInput("", key({ rightArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 3,
    })
  })

  test("uses up and down to select suggestions when suggestions are visible", () => {
    const suggestionState = {
      shouldShowSuggestions: true,
      selectedSuggestionIndex: 1,
      suggestionCount: 3,
    }

    expect(
      handleBaseModeInput("", key({ upArrow: true }), state, limits, suggestionState),
    ).toEqual({
      state,
      selectedSuggestionIndex: 0,
    })
    expect(
      handleBaseModeInput("", key({ downArrow: true }), state, limits, suggestionState),
    ).toEqual({
      state,
      selectedSuggestionIndex: 2,
    })
  })

  test("handles page and boundary scroll keys", () => {
    expect(handleBaseModeInput("", key({ pageUp: true }), state, limits).state).toEqual({
      ...state,
      scrollY: 0,
    })
    expect(
      handleBaseModeInput("", key({ pageDown: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 7,
    })
    expect(handleBaseModeInput("", key({ home: true }), state, limits).state).toEqual({
      ...state,
      scrollX: 0,
      scrollY: 0,
    })
    expect(handleBaseModeInput("", key({ end: true }), state, limits).state).toEqual({
      ...state,
      scrollX: 5,
      scrollY: 10,
    })
  })

  test("handles command input editing and submit", () => {
    expect(handleBaseModeInput("x", defaultKey, state, limits).state.command).toBe("getx")
    expect(
      handleBaseModeInput("", key({ backspace: true }), state, limits).state.command,
    ).toBe("ge")

    const result = handleBaseModeInput("", key({ return: true }), state, limits)

    expect(result.command).toBe("get")
    expect(result.state.command).toBe("")
  })
})

describe("search mode key helpers", () => {
  test("finds matches from regex queries", () => {
    expect(findSearchMatches("item-1\nitem-22\nitem-x", "item-\\d+")).toEqual([
      {
        lineIndex: 0,
        start: 0,
        end: 6,
      },
      {
        lineIndex: 1,
        start: 0,
        end: 7,
      },
    ])
  })

  test("falls back to plain text matching for invalid regex queries", () => {
    expect(findSearchMatches("abc [test\nabc test", "[test")).toEqual([
      {
        lineIndex: 0,
        start: 4,
        end: 9,
      },
    ])
  })

  test("uses up and down to focus search matches", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }
    const matches = findSearchMatches("abc\nnone\nabc", "abc")

    const nextResult = handleSearchModeInput(
      "",
      key({ downArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(nextResult.state.focusedMatchIndex).toBe(1)
    expect(nextResult.state.scrollY).toBe(2)

    const previousResult = handleSearchModeInput(
      "",
      key({ upArrow: true }),
      nextResult.state,
      searchLimits,
      matches,
    )

    expect(previousResult.state.focusedMatchIndex).toBe(0)
    expect(previousResult.state.scrollY).toBe(0)
  })

  test("scrolls search mode right when the next focused match is outside the viewport", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }
    const matches = findSearchMatches("abc abc", "abc")

    const result = handleSearchModeInput(
      "",
      key({ downArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(1)
    expect(result.state.scrollX).toBe(4)
  })

  test("scrolls search mode left when the previous focused match is outside the viewport", () => {
    const searchState: SearchModeState = {
      scrollX: 4,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 1,
    }
    const matches = findSearchMatches("abc abc", "abc")

    const result = handleSearchModeInput(
      "",
      key({ upArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(0)
    expect(result.state.scrollX).toBe(0)
  })

  test("updates search input without changing active query until submit", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "old",
      focusedMatchIndex: 0,
    }

    const typedResult = handleSearchModeInput(
      "n",
      defaultKey,
      searchState,
      searchLimits,
      [],
    )

    expect(typedResult.state.input).toBe("n")
    expect(typedResult.state.query).toBe("old")

    const submitResult = handleSearchModeInput(
      "",
      key({ return: true }),
      {
        ...typedResult.state,
        input: "new",
      },
      searchLimits,
      [],
    )

    expect(submitResult.submittedQuery).toBe("new")
    expect(submitResult.state.input).toBe("")
    expect(submitResult.state.query).toBe("new")
  })
})
