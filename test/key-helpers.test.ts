import { describe, expect, test } from "bun:test"
import type { Key } from "ink"
import {
  handleBaseModeInput,
  type BaseModeLimits,
  type BaseModeState,
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
