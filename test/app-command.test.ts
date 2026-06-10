import { describe, expect, test } from "@jest/globals"
import {
  isAppExitCommand,
  isAppReloadCommand,
  resolveModeCommand,
  resolveQuickSwitchMode,
  resolveAppInputCommand,
  TerminalMode,
} from "../src/runtime/app-command.ts"

describe("app commands", () => {
  test("resolves mode commands", () => {
    expect(resolveModeCommand("@query")).toBe(TerminalMode.Query)
    expect(resolveModeCommand("@q")).toBe(TerminalMode.Query)
    expect(resolveModeCommand("@search")).toBe(TerminalMode.Search)
    expect(resolveModeCommand("@s")).toBe(TerminalMode.Search)
    expect(resolveModeCommand("@view")).toBe(TerminalMode.View)
    expect(resolveModeCommand("@v")).toBe(TerminalMode.View)
    expect(resolveModeCommand("@edit")).toBe(TerminalMode.Edit)
    expect(resolveModeCommand("@e")).toBe(TerminalMode.Edit)
    expect(resolveModeCommand("@ai")).toBe(TerminalMode.Ai)
    expect(resolveModeCommand("@a")).toBe(TerminalMode.Ai)
  })

  test("resolves app commands", () => {
    expect(isAppExitCommand("@exit")).toBe(true)
    expect(isAppExitCommand("@quit")).toBe(true)
    expect(isAppReloadCommand("@reload")).toBe(true)
  })

  test("resolves terminal command kinds", () => {
    expect(resolveAppInputCommand("")).toEqual({
      type: "empty",
    })
    expect(resolveAppInputCommand(" @reload ")).toEqual({
      type: "app",
      command: "reload",
    })
    expect(resolveAppInputCommand("@ai")).toEqual({
      type: "mode",
      mode: TerminalMode.Ai,
    })
    expect(resolveAppInputCommand("request/example")).toEqual({
      type: "request",
      path: "request/example",
    })
  })

  test("resolves quick switch modes in query, view, search, ai order", () => {
    expect(resolveQuickSwitchMode(TerminalMode.Query)).toBe(TerminalMode.View)
    expect(resolveQuickSwitchMode(TerminalMode.View)).toBe(TerminalMode.Search)
    expect(resolveQuickSwitchMode(TerminalMode.Search)).toBe(TerminalMode.Ai)
    expect(resolveQuickSwitchMode(TerminalMode.Ai)).toBe(TerminalMode.Query)
    expect(resolveQuickSwitchMode(TerminalMode.Edit)).toBeNull()
  })
})
