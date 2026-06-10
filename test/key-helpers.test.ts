import { describe, expect, test } from "@jest/globals"
import type { Key } from "ink"
import {
  createEditModeState,
  createAiModeState,
  findSearchMatches,
  handleAiModeInput,
  handleEditModeInput,
  handleQueryModeInput,
  handleSearchModeInput,
  handleViewModeInput,
  serializeEditModeContent,
  type QueryModeLimits,
  type QueryModeState,
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

const state: QueryModeState = {
  scrollX: 2,
  scrollY: 3,
  command: "get",
  commandCursorX: 3,
}

const limits: QueryModeLimits = {
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

describe("ai mode key helpers", () => {
  test("handles input, submit, and exit", () => {
    const typedResult = handleAiModeInput(
      "hello",
      defaultKey,
      createAiModeState(),
    )

    expect(typedResult.state.input).toBe("hello")
    expect(typedResult.state.inputCursorX).toBe(5)

    const submitResult = handleAiModeInput(
      "",
      key({ return: true }),
      typedResult.state,
    )

    expect(submitResult.state.input).toBe("")
    expect(submitResult.state.inputCursorX).toBe(0)
    expect(submitResult.state.scrollY).toBe(0)
    expect(submitResult.state.messages).toEqual([
      {
        role: "user",
        content: "hello",
      },
    ])

    const exitResult = handleAiModeInput(
      "",
      key({ escape: true }),
      submitResult.state,
    )

    expect(exitResult.shouldExitAi).toBe(true)
  })

  test("edits input at the cursor", () => {
    const typedResult = handleAiModeInput(
      "hello",
      defaultKey,
      createAiModeState(),
    )
    const movedResult = handleAiModeInput(
      "",
      key({ leftArrow: true }),
      typedResult.state,
    )
    const insertedResult = handleAiModeInput("!", defaultKey, movedResult.state)
    const backspaceResult = handleAiModeInput(
      "",
      key({ backspace: true }),
      insertedResult.state,
    )

    expect(movedResult.state.inputCursorX).toBe(4)
    expect(insertedResult.state.input).toBe("hell!o")
    expect(insertedResult.state.inputCursorX).toBe(5)
    expect(backspaceResult.state.input).toBe("hello")
    expect(backspaceResult.state.inputCursorX).toBe(4)
  })

  test("handles app exit commands in ai mode", () => {
    const exitResult = handleAiModeInput("", key({ return: true }), {
      ...createAiModeState(),
      input: "@exit",
    })
    const quitResult = handleAiModeInput("", key({ return: true }), {
      ...createAiModeState(),
      input: "@quit",
    })

    expect(exitResult.shouldExitApp).toBe(true)
    expect(exitResult.state.input).toBe("")
    expect(exitResult.state.messages).toEqual([])
    expect(quitResult.shouldExitApp).toBe(true)
  })

  test("handles app reload commands in ai mode", () => {
    const reloadResult = handleAiModeInput("", key({ return: true }), {
      ...createAiModeState(),
      input: "@reload",
    })

    expect(reloadResult.shouldReloadApp).toBe(true)
    expect(reloadResult.state.input).toBe("")
    expect(reloadResult.state.messages).toEqual([])
  })

  test("scrolls chat history with up and down arrows", () => {
    const aiState = {
      ...createAiModeState(),
      scrollY: 2,
    }

    expect(
      handleAiModeInput("", key({ upArrow: true }), aiState, {
        maxScrollY: 5,
      }).state.scrollY,
    ).toBe(3)
    expect(
      handleAiModeInput("", key({ downArrow: true }), aiState, {
        maxScrollY: 5,
      }).state.scrollY,
    ).toBe(1)
    expect(
      handleAiModeInput("", key({ upArrow: true }), aiState, {
        maxScrollY: 0,
      }).state.scrollY,
    ).toBe(0)
  })
})

describe("view mode key helpers", () => {
  test("handles input editing and submit", () => {
    const viewState = {
      command: "example",
      commandCursorX: 7,
      scrollX: 0,
      scrollY: 0,
    }

    expect(handleViewModeInput("x", defaultKey, viewState).state.command).toBe(
      "examplex",
    )
    expect(
      handleViewModeInput("", key({ backspace: true }), viewState).state
        .command,
    ).toBe("exampl")

    const submitResult = handleViewModeInput(
      "",
      key({ return: true }),
      viewState,
    )

    expect(submitResult.selectedCommand).toBe("example")
    const escapeResult = handleViewModeInput(
      "",
      key({ escape: true }),
      viewState,
    )

    expect(escapeResult.state).toEqual(viewState)
    expect(escapeResult.shouldMoveToParentDirectory).toBe(true)
  })

  test("handles reviewing pane scrolling", () => {
    const viewState = { command: "", commandCursorX: 0, scrollX: 2, scrollY: 3 }
    const viewLimits = {
      maxScrollX: 5,
      maxScrollY: 10,
      viewHeight: 4,
    }

    expect(
      handleViewModeInput("", key({ upArrow: true }), viewState, viewLimits)
        .state.scrollY,
    ).toBe(2)
    expect(
      handleViewModeInput("", key({ downArrow: true }), viewState, viewLimits)
        .state.scrollY,
    ).toBe(4)
    expect(
      handleViewModeInput("", key({ leftArrow: true }), viewState, viewLimits)
        .state.scrollX,
    ).toBe(1)
    expect(
      handleViewModeInput("", key({ rightArrow: true }), viewState, viewLimits)
        .state.scrollX,
    ).toBe(3)
  })

  test("reports file tree selection movement", () => {
    const viewState = { command: "", commandCursorX: 0, scrollX: 2, scrollY: 3 }

    expect(
      handleViewModeInput("", key({ shift: true, downArrow: true }), viewState)
        .fileTreeSelectionDirection,
    ).toBe(1)
    expect(
      handleViewModeInput("", key({ shift: true, upArrow: true }), viewState)
        .fileTreeSelectionDirection,
    ).toBe(-1)
  })

  test("edits view command input at the cursor", () => {
    const viewState = {
      command: "folder/request",
      commandCursorX: 14,
      scrollX: 0,
      scrollY: 0,
    }
    const movedResult = handleViewModeInput(
      "",
      key({ shift: true, leftArrow: true }),
      viewState,
    )
    const insertedResult = handleViewModeInput(
      "-x",
      defaultKey,
      movedResult.state,
    )
    const removedResult = handleViewModeInput(
      "",
      key({ backspace: true }),
      insertedResult.state,
    )

    expect(movedResult.state.commandCursorX).toBe(13)
    expect(insertedResult.state.command).toBe("folder/reques-xt")
    expect(insertedResult.state.commandCursorX).toBe(15)
    expect(removedResult.state.command).toBe("folder/reques-t")
    expect(removedResult.state.commandCursorX).toBe(14)
  })

  test("uses control e as an edit mode shortcut", () => {
    const viewState = {
      command: "",
      commandCursorX: 0,
      scrollX: 0,
      scrollY: 0,
    }
    const result = handleViewModeInput("e", key({ ctrl: true }), viewState)

    expect(result.selectedCommand).toBe("@edit")
    expect(result.state).toEqual(viewState)
  })

  test("uses raw control e input as an edit mode shortcut", () => {
    const viewState = {
      command: "",
      commandCursorX: 0,
      scrollX: 0,
      scrollY: 0,
    }
    const result = handleViewModeInput("\u0005", defaultKey, viewState)

    expect(result.selectedCommand).toBe("@edit")
    expect(result.state).toEqual(viewState)
  })
})

describe("edit mode key helpers", () => {
  test("moves the cursor and clamps to shorter target lines", () => {
    const editState = {
      ...createEditModeState("abcdef\nxy"),
      cursorX: 5,
      cursorY: 0,
    }

    const result = handleEditModeInput("", key({ downArrow: true }), editState)

    expect(result.state.cursorY).toBe(1)
    expect(result.state.cursorX).toBe(2)
  })

  test("buffers input and inserts it on enter", () => {
    const typedResult = handleEditModeInput(
      "X",
      defaultKey,
      createEditModeState("abc"),
    )

    expect(typedResult.state.input).toBe("X")
    expect(typedResult.state.inputCursorX).toBe(1)
    expect(serializeEditModeContent(typedResult.state)).toBe("abc")

    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      typedResult.state,
    )

    expect(appliedResult.state.input).toBe("")
    expect(appliedResult.state.inputCursorX).toBe(0)
    expect(appliedResult.state.cursorX).toBe(1)
    expect(serializeEditModeContent(appliedResult.state)).toBe("Xabc")
  })

  test("suggests and applies request keywords", () => {
    const typedResult = handleEditModeInput(
      "hea",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "header",
          insertText: "header ",
          kind: "keyword",
        },
      ],
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe("header")

    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      typedResult.state,
      [
        {
          label: "header",
          insertText: "header ",
          kind: "keyword",
        },
      ],
    )

    expect(serializeEditModeContent(appliedResult.state)).toBe("header ")
    expect(appliedResult.state.cursorX).toBe(7)
    expect(appliedResult.state.suggestions).toBeNull()
  })

  test("suggests and applies header names after header keyword", () => {
    const typedResult = handleEditModeInput(
      "header cont",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "content-type",
          insertText: "content-type, ",
          kind: "header",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe(
      "content-type",
    )
    expect(serializeEditModeContent(appliedResult.state)).toBe(
      "header content-type, ",
    )
    expect(appliedResult.state.cursorX).toBe(21)
  })

  test("suggests and applies custom header names after header keyword", () => {
    const typedResult = handleEditModeInput(
      "header x-tr",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "x-trace-token",
          insertText: "x-trace-token, ",
          kind: "header",
        },
        {
          label: "x-trace-token",
          insertText: "x-trace-token: ",
          kind: "bodyKey",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe(
      "x-trace-token",
    )
    expect(serializeEditModeContent(appliedResult.state)).toBe(
      "header x-trace-token, ",
    )
  })

  test("suggests and applies custom body keys in object bodies", () => {
    const typedResult = handleEditModeInput(
      "some",
      defaultKey,
      {
        ...createEditModeState("body { "),
        cursorX: 7,
      },
      [
        {
          label: "some-style-id",
          insertText: "some-style-id, ",
          kind: "header",
        },
        {
          label: "some-style-id",
          insertText: "some-style-id: ",
          kind: "bodyKey",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe(
      "some-style-id",
    )
    expect(serializeEditModeContent(appliedResult.state)).toBe(
      "body { some-style-id: ",
    )
  })

  test("applies suggestions with enter before normal edit submit", () => {
    const typedResult = handleEditModeInput(
      "hea",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "header",
          insertText: "header ",
          kind: "keyword",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      typedResult.state,
    )

    expect(serializeEditModeContent(appliedResult.state)).toBe("header ")
    expect(appliedResult.state.cursorX).toBe(7)
    expect(appliedResult.state.input).toBe("")
  })

  test("suggests macros and moves the suggestion highlight", () => {
    const typedResult = handleEditModeInput(
      "@",
      defaultKey,
      {
        ...createEditModeState("body "),
        cursorX: 5,
      },
      [
        {
          label: "@i",
          insertText: "@i()",
          cursorOffset: 3,
          kind: "macro",
        },
        {
          label: "@f",
          insertText: "@f()",
          cursorOffset: 3,
          kind: "macro",
        },
        {
          label: "@i(token)",
          insertText: "@i(token)",
          kind: "macro",
        },
      ],
    )
    const movedResult = handleEditModeInput(
      "",
      key({ downArrow: true }),
      typedResult.state,
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      movedResult.state,
    )

    expect(movedResult.state.suggestions?.selectedIndex).toBe(1)
    expect(serializeEditModeContent(appliedResult.state)).toBe("body @f()")
    expect(appliedResult.state.cursorX).toBe(8)
  })

  test("uses up and down to select suggestions while the overlay is open", () => {
    const typedResult = handleEditModeInput(
      "@",
      defaultKey,
      {
        ...createEditModeState("body "),
        cursorX: 5,
      },
      [
        {
          label: "@i",
          insertText: "@i()",
          cursorOffset: 3,
          kind: "macro",
        },
        {
          label: "@f",
          insertText: "@f()",
          cursorOffset: 3,
          kind: "macro",
        },
      ],
    )
    const movedDownResult = handleEditModeInput(
      "",
      key({ downArrow: true }),
      typedResult.state,
    )
    const movedUpResult = handleEditModeInput(
      "",
      key({ upArrow: true }),
      movedDownResult.state,
    )

    expect(movedDownResult.state.cursorY).toBe(0)
    expect(movedDownResult.state.suggestions?.selectedIndex).toBe(1)
    expect(movedUpResult.state.suggestions?.selectedIndex).toBe(0)
  })

  test("suggests concrete intermediate macros from definition keys at @", () => {
    const typedResult = handleEditModeInput(
      "@",
      defaultKey,
      {
        ...createEditModeState("body "),
        cursorX: 5,
      },
      [
        {
          label: "@i(token)",
          insertText: "@i(token)",
          kind: "macro",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe("@i(token)")
    expect(serializeEditModeContent(appliedResult.state)).toBe("body @i(token)")
    expect(appliedResult.state.cursorX).toBe(14)
  })

  test("suggests referenced definition keys inside intermediate macros", () => {
    const typedResult = handleEditModeInput(
      "@i(",
      defaultKey,
      {
        ...createEditModeState("body "),
        cursorX: 5,
      },
      [
        {
          label: "token",
          insertText: "token",
          kind: "definition",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ tab: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe("token")
    expect(serializeEditModeContent(appliedResult.state)).toBe("body @i(token")
    expect(appliedResult.state.cursorX).toBe(13)
  })

  test("suggests and applies ref paths from dynamic lookup results", () => {
    const typedResult = handleEditModeInput(
      "ref u",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "user.ntd",
          insertText: "user.ntd",
          kind: "ref",
        },
      ],
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      typedResult.state,
    )

    expect(typedResult.state.suggestions?.options[0]?.label).toBe("user.ntd")
    expect(serializeEditModeContent(appliedResult.state)).toBe("ref user.ntd")
    expect(appliedResult.state.cursorX).toBe(12)
  })

  test("does not keep suggesting after a ref path is complete", () => {
    const result = handleEditModeInput(
      "ref user.ntd",
      defaultKey,
      createEditModeState(""),
      [
        {
          label: "user.ntd",
          insertText: "user.ntd",
          kind: "ref",
        },
      ],
    )

    expect(result.state.suggestions).toBeNull()
  })

  test("moves the buffered input cursor with shift arrows", () => {
    const typedResult = handleEditModeInput(
      "abc",
      defaultKey,
      createEditModeState("xyz"),
    )
    const movedResult = handleEditModeInput(
      "",
      key({ shift: true, leftArrow: true }),
      typedResult.state,
    )
    const insertedResult = handleEditModeInput(
      "X",
      defaultKey,
      movedResult.state,
    )

    expect(insertedResult.state.input).toBe("abXc")
    expect(insertedResult.state.inputCursorX).toBe(3)

    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      insertedResult.state,
    )

    expect(serializeEditModeContent(appliedResult.state)).toBe("abXcxyz")
  })

  test("splits the current line on enter with empty input", () => {
    const middleResult = handleEditModeInput("", key({ return: true }), {
      ...createEditModeState("abcd"),
      cursorX: 2,
    })

    expect(serializeEditModeContent(middleResult.state)).toBe("ab\ncd")
    expect(middleResult.state.cursorX).toBe(0)
    expect(middleResult.state.cursorY).toBe(1)

    const beginningResult = handleEditModeInput("", key({ return: true }), {
      ...createEditModeState("abcd"),
      cursorX: 0,
    })

    expect(serializeEditModeContent(beginningResult.state)).toBe("\nabcd")
    expect(beginningResult.state.cursorX).toBe(0)
    expect(beginningResult.state.cursorY).toBe(1)

    const endResult = handleEditModeInput("", key({ return: true }), {
      ...createEditModeState("abcd"),
      cursorX: 4,
    })

    expect(serializeEditModeContent(endResult.state)).toBe("abcd\n")
    expect(endResult.state.cursorX).toBe(0)
    expect(endResult.state.cursorY).toBe(1)
  })

  test("removes file content with backspace", () => {
    const removedResult = handleEditModeInput("", key({ backspace: true }), {
      ...createEditModeState("abc"),
      cursorX: 2,
    })

    expect(serializeEditModeContent(removedResult.state)).toBe("ac")
    expect(removedResult.state.cursorX).toBe(1)
  })

  test("opens save confirmation and selects yes or no", () => {
    const promptResult = handleEditModeInput(
      "",
      key({ escape: true }),
      createEditModeState("abc"),
    )

    expect(promptResult.state.isSavePromptOpen).toBe(true)
    expect(promptResult.state.selectedSaveAction).toBe("yes")

    const noResult = handleEditModeInput(
      "",
      key({ rightArrow: true }),
      promptResult.state,
    )

    expect(noResult.state.selectedSaveAction).toBe("no")

    const confirmResult = handleEditModeInput(
      "",
      key({ return: true }),
      noResult.state,
    )

    expect(confirmResult.shouldSave).toBe(false)
    expect(confirmResult.shouldExitEdit).toBe(true)
  })

  test("saves directly with control s", () => {
    const result = handleEditModeInput(
      "s",
      key({ ctrl: true }),
      createEditModeState("abc"),
    )

    expect(result.shouldSave).toBe(true)
    expect(result.shouldExitEdit).toBe(true)
    expect(result.state.isSavePromptOpen).toBe(false)
    expect(result.state.selectedSaveAction).toBe("yes")
    expect(result.state.suggestions).toBeNull()
  })

  test("saves directly with raw control s input", () => {
    const result = handleEditModeInput(
      "\u0013",
      defaultKey,
      createEditModeState("abc"),
    )

    expect(result.shouldSave).toBe(true)
    expect(result.shouldExitEdit).toBe(true)
  })

  test("selects the current token with control a", () => {
    const result = handleEditModeInput("a", key({ ctrl: true }), {
      ...createEditModeState("header accept, @i(content-type)"),
      cursorX: 3,
    })

    expect(serializeEditModeContent(result.state)).toBe(
      " accept, @i(content-type)",
    )
    expect(result.state.cursorX).toBe(0)
    expect(result.state.input).toBe("header")
    expect(result.state.inputCursorX).toBe(6)
  })

  test("selects tokens from their beginning or ending cursor positions", () => {
    const beginResult = handleEditModeInput("a", key({ ctrl: true }), {
      ...createEditModeState("header accept, @i(content-type)"),
      cursorX: 7,
    })
    const endResult = handleEditModeInput("a", key({ ctrl: true }), {
      ...createEditModeState("header accept, @i(content-type)"),
      cursorX: 14,
    })

    expect(beginResult.state.input).toBe("accept,")
    expect(beginResult.state.cursorX).toBe(7)
    expect(serializeEditModeContent(beginResult.state)).toBe(
      "header  @i(content-type)",
    )
    expect(endResult.state.input).toBe("accept,")
    expect(endResult.state.cursorX).toBe(7)
    expect(serializeEditModeContent(endResult.state)).toBe(
      "header  @i(content-type)",
    )
  })

  test("does not select anything when both sides of the cursor are spaces", () => {
    const stateWithSpaces = {
      ...createEditModeState("xxxx   bbbbb"),
      cursorX: 6,
    }
    const result = handleEditModeInput("\u0001", defaultKey, stateWithSpaces)

    expect(result.state).toEqual({
      ...stateWithSpaces,
      suggestions: null,
    })
  })

  test("allows editing and reinserting a selected token", () => {
    const selectedResult = handleEditModeInput("a", key({ ctrl: true }), {
      ...createEditModeState("header accept"),
      cursorX: 3,
    })
    const movedResult = handleEditModeInput(
      "",
      key({ shift: true, leftArrow: true }),
      selectedResult.state,
    )
    const insertedResult = handleEditModeInput(
      "-x",
      defaultKey,
      movedResult.state,
    )
    const appliedResult = handleEditModeInput(
      "",
      key({ return: true }),
      insertedResult.state,
    )

    expect(insertedResult.state.input).toBe("heade-xr")
    expect(serializeEditModeContent(appliedResult.state)).toBe(
      "heade-xr accept",
    )
  })
})

describe("query mode key helpers", () => {
  test("handles vertical and horizontal scroll keys", () => {
    expect(
      handleQueryModeInput("", key({ upArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 2,
    })
    expect(
      handleQueryModeInput("", key({ downArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 4,
    })
    expect(
      handleQueryModeInput("", key({ leftArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 1,
    })
    expect(
      handleQueryModeInput("", key({ rightArrow: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 3,
    })
  })

  test("handles page and boundary scroll keys", () => {
    expect(
      handleQueryModeInput("", key({ pageUp: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 0,
    })
    expect(
      handleQueryModeInput("", key({ pageDown: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollY: 7,
    })
    expect(
      handleQueryModeInput("", key({ home: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 0,
      scrollY: 0,
    })
    expect(
      handleQueryModeInput("", key({ end: true }), state, limits).state,
    ).toEqual({
      ...state,
      scrollX: 5,
      scrollY: 10,
    })
  })

  test("handles command input editing and submit", () => {
    expect(
      handleQueryModeInput("x", defaultKey, state, limits).state.command,
    ).toBe("getx")
    expect(
      handleQueryModeInput("", key({ backspace: true }), state, limits).state
        .command,
    ).toBe("ge")

    const result = handleQueryModeInput(
      "",
      key({ return: true }),
      state,
      limits,
    )

    expect(result.command).toBe("get")
    expect(result.state.command).toBe("")
  })

  test("reports parent directory movement", () => {
    const result = handleQueryModeInput(
      "",
      key({ escape: true }),
      state,
      limits,
    )

    expect(result.state).toEqual(state)
    expect(result.shouldMoveToParentDirectory).toBe(true)
  })

  test("reports file tree selection movement", () => {
    expect(
      handleQueryModeInput(
        "",
        key({ shift: true, downArrow: true }),
        state,
        limits,
      ).fileTreeSelectionDirection,
    ).toBe(1)
    expect(
      handleQueryModeInput(
        "",
        key({ shift: true, upArrow: true }),
        state,
        limits,
      ).fileTreeSelectionDirection,
    ).toBe(-1)
  })

  test("edits command input at the cursor", () => {
    const movedResult = handleQueryModeInput(
      "",
      key({ shift: true, leftArrow: true }),
      state,
      limits,
    )
    const insertedResult = handleQueryModeInput(
      "!",
      defaultKey,
      movedResult.state,
      limits,
    )
    const removedResult = handleQueryModeInput(
      "",
      key({ backspace: true }),
      insertedResult.state,
      limits,
    )

    expect(movedResult.state.commandCursorX).toBe(2)
    expect(insertedResult.state.command).toBe("ge!t")
    expect(insertedResult.state.commandCursorX).toBe(3)
    expect(removedResult.state.command).toBe("get")
    expect(removedResult.state.commandCursorX).toBe(2)
  })
})

describe("search mode key helpers", () => {
  test("uses a larger horizontal scroll step in search mode", () => {
    const searchState: SearchModeState = {
      scrollX: 8,
      scrollY: 0,
      input: "",
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
      inputCursorX: 0,
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
    expect(submitResult.state.inputCursorX).toBe(0)
    expect(submitResult.state.query).toBe("new")
  })

  test("edits search input at the cursor", () => {
    const searchState: SearchModeState = {
      scrollX: 0,
      scrollY: 0,
      input: "abc",
      inputCursorX: 3,
      query: "",
      focusedMatchIndex: 0,
    }
    const movedResult = handleSearchModeInput(
      "",
      key({ shift: true, leftArrow: true }),
      searchState,
      searchLimits,
      [],
    )
    const insertedResult = handleSearchModeInput(
      "X",
      defaultKey,
      movedResult.state,
      searchLimits,
      [],
    )
    const removedResult = handleSearchModeInput(
      "",
      key({ backspace: true }),
      insertedResult.state,
      searchLimits,
      [],
    )

    expect(movedResult.state.inputCursorX).toBe(2)
    expect(insertedResult.state.input).toBe("abXc")
    expect(insertedResult.state.inputCursorX).toBe(3)
    expect(removedResult.state.input).toBe("abc")
    expect(removedResult.state.inputCursorX).toBe(2)
  })
})
