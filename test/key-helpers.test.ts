import { describe, expect, test } from "@jest/globals"
import type { Key } from "ink"
import {
  findSearchMatches,
  handleBaseModeInput,
  handleSearchModeInput,
  resolveModeCommand,
  TerminalMode,
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
  maxScrollX: 20,
  viewWidth: 10,
}

const key = (keyValues: Partial<Key>): Key => {
  return {
    ...defaultKey,
    ...keyValues,
  }
}

describe("mode commands", () => {
  test("resolves long and short mode commands", () => {
    expect(resolveModeCommand("@query")).toBe(TerminalMode.Query)
    expect(resolveModeCommand("@q")).toBe(TerminalMode.Query)
    expect(resolveModeCommand("@search")).toBe(TerminalMode.Search)
    expect(resolveModeCommand("@s")).toBe(TerminalMode.Search)
  })
})

describe("base mode key helpers", () => {
  test("handles vertical and horizontal scroll keys", () => {
    expect(
      handleBaseModeInput("", key({ upArrow: true }), state, limits).state,
    ).toEqual({
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

  test("handles page and boundary scroll keys", () => {
    expect(
      handleBaseModeInput("", key({ pageUp: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 0,
    })
    expect(
      handleBaseModeInput("", key({ pageDown: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 7,
    })
    expect(
      handleBaseModeInput("", key({ home: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 0,
      scrollY: 0,
    })
    expect(
      handleBaseModeInput("", key({ end: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 5,
      scrollY: 10,
    })
  })

  test("handles command input editing and submit", () => {
    expect(
      handleBaseModeInput("x", defaultKey, state, limits).state.command,
    ).toBe("getx")
    expect(
      handleBaseModeInput("", key({ backspace: true }), state, limits).state
        .command,
    ).toBe("ge")

    const result = handleBaseModeInput("", key({ return: true }), state, limits)

    expect(result.command).toBe("get")
    expect(result.state.command).toBe("")
  })
})

describe("search mode key helpers", () => {
  test("uses a larger horizontal scroll step in search mode", () => {
    const searchState: SearchModeState = {
      scrollX: 8,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }

    expect(
      handleSearchModeInput(
        "",
        key({ leftArrow: true }),
        searchState,
        searchLimits,
        [],
      ).state.scrollX,
    ).toBe(4)

    expect(
      handleSearchModeInput(
        "",
        key({ rightArrow: true }),
        searchState,
        searchLimits,
        [],
      ).state.scrollX,
    ).toBe(12)
  })

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
    expect(nextResult.state.scrollY).toBe(0)

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

  test("keeps focused search matches below the top of the viewport when possible", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }
    const matches = findSearchMatches(
      "none\nnone\nnone\nabc\nnone\nnone\nnone\nnone",
      "abc",
    )

    const result = handleSearchModeInput(
      "",
      key({ downArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(0)
    expect(result.state.scrollY).toBe(1)
  })

  test("scrolls search mode horizontally without changing the current match", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }
    const matches = findSearchMatches("abc long-text abc", "abc")

    const result = handleSearchModeInput(
      "",
      key({ rightArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(0)
    expect(result.state.scrollX).toBe(4)
  })

  test("scrolls search mode right when the next focused match is outside the viewport", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 0,
    }
    const matches = findSearchMatches("abc long-text abc", "abc")

    const result = handleSearchModeInput(
      "",
      key({ downArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(1)
    expect(result.state.scrollX).toBe(11)
  })

  test("scrolls search mode left when the previous focused match is outside the viewport", () => {
    const searchState: SearchModeState = {
      scrollX: 11,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 1,
    }
    const matches = findSearchMatches("abc long-text abc", "abc")

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

  test("scrolls search mode left without changing the current match", () => {
    const searchState: SearchModeState = {
      scrollX: 11,
      scrollY: 0,
      input: "",
      query: "abc",
      focusedMatchIndex: 1,
    }
    const matches = findSearchMatches("abc long-text abc", "abc")

    const result = handleSearchModeInput(
      "",
      key({ leftArrow: true }),
      searchState,
      searchLimits,
      matches,
    )

    expect(result.state.focusedMatchIndex).toBe(1)
    expect(result.state.scrollX).toBe(7)
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
