import { describe, expect, test } from "@jest/globals"
import {
  isAppCopyReportCommand,
  isAppExitCommand,
  isAppReloadCommand,
  parseAppCommandInput,
  QueryCommand,
  resolveModeCommand,
  resolveQuickSwitchMode,
  resolveAppInputCommand,
  TerminalMode,
} from "../src/runtime/app-command/index.ts"

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
    expect(resolveModeCommand("@history")).toBe(TerminalMode.History)
    expect(resolveModeCommand("@h")).toBe(TerminalMode.History)
  })

  test("resolves app commands", () => {
    expect(isAppExitCommand("@exit")).toBe(true)
    expect(isAppExitCommand("@quit")).toBe(true)
    expect(isAppReloadCommand("@reload")).toBe(true)
    expect(isAppCopyReportCommand("@report")).toBe(true)
    expect(isAppCopyReportCommand("@copy")).toBe(true)
    expect(isAppCopyReportCommand("@reload")).toBe(false)
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
    expect(resolveAppInputCommand("@cc")).toEqual({
      type: "app",
      command: "clean-cache",
    })
    expect(resolveAppInputCommand("@clean-cache")).toEqual({
      type: "app",
      command: "clean-cache",
    })
    expect(resolveAppInputCommand("@report")).toEqual({
      type: "app",
      command: "copy-report",
    })
    expect(resolveAppInputCommand("@copy")).toEqual({
      type: "app",
      command: "copy-report",
    })
    expect(resolveAppInputCommand("request/example")).toEqual({
      type: "request",
      path: "request/example",
    })
  })

  test("lets each command identify matching input", () => {
    const command = new QueryCommand()

    expect(command.identify(parseAppCommandInput("@query")!)).toBe(true)
    expect(command.identify(parseAppCommandInput("@q")!)).toBe(true)
    expect(command.identify(parseAppCommandInput("@search")!)).toBe(false)
  })

  test("parses command args for future command argument support", () => {
    expect(parseAppCommandInput("@search uuid")).toEqual({
      source: "@search uuid",
      name: "@search",
      args: ["uuid"],
    })
  })

  test("carries trailing text as args on a mode command", () => {
    expect(resolveAppInputCommand("@search uuid")).toEqual({
      type: "mode",
      mode: TerminalMode.Search,
      args: ["uuid"],
    })
    expect(resolveAppInputCommand("@s some text here")).toEqual({
      type: "mode",
      mode: TerminalMode.Search,
      args: ["some", "text", "here"],
    })
    expect(resolveAppInputCommand("@search")).toEqual({
      type: "mode",
      mode: TerminalMode.Search,
    })
  })

  test("resolves quick switch modes in query, view, ai order without search", () => {
    expect(resolveQuickSwitchMode(TerminalMode.Query)).toBe(TerminalMode.View)
    expect(resolveQuickSwitchMode(TerminalMode.View)).toBe(TerminalMode.Ai)
    expect(resolveQuickSwitchMode(TerminalMode.Ai)).toBe(TerminalMode.Query)
    expect(resolveQuickSwitchMode(TerminalMode.Search)).toBeNull()
    expect(resolveQuickSwitchMode(TerminalMode.Edit)).toBeNull()
  })
})
