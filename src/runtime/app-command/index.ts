import { appCommands } from "./commands/index.ts"
import { parseAppCommandInput } from "./input.ts"
import {
  TerminalMode,
  type AppActionCommand,
  type AppCommand,
} from "./types.ts"

export {
  AiCommand,
  CleanCacheCommand,
  EditCommand,
  ExitCommand,
  QueryCommand,
  ReloadCommand,
  SearchCommand,
  ViewCommand,
} from "./commands/index.ts"
export { parseAppCommandInput } from "./input.ts"
export {
  TerminalMode,
  type AppActionCommand,
  type AppCommand,
  type AppCommandDefinition,
  type ParsedAppCommandInput,
} from "./types.ts"

// Search is intentionally excluded: it is entered explicitly via `@s`/`@search`
// (optionally with a query) and left with Esc back to the previous mode.
export const quickSwitchModeSequence = [
  TerminalMode.Query,
  TerminalMode.View,
  TerminalMode.Ai,
] as const

export const resolveAppCommand = (command: string): AppActionCommand | null => {
  const input = parseAppCommandInput(command)

  if (!input) {
    return null
  }

  const resolvedCommand = appCommands
    .find((appCommand) => appCommand.identify(input))
    ?.resolve(input)

  return resolvedCommand?.type === "app" ? resolvedCommand.command : null
}

export const isAppExitCommand = (command: string): boolean => {
  return resolveAppCommand(command) === "exit"
}

export const isAppReloadCommand = (command: string): boolean => {
  return resolveAppCommand(command) === "reload"
}

export const resolveModeCommand = (command: string): TerminalMode | null => {
  const input = parseAppCommandInput(command)

  if (!input) {
    return null
  }

  const resolvedCommand = appCommands
    .find((appCommand) => appCommand.identify(input))
    ?.resolve(input)

  return resolvedCommand?.type === "mode" ? resolvedCommand.mode : null
}

export const resolveAppInputCommand = (inputText: string): AppCommand => {
  const input = parseAppCommandInput(inputText)

  if (!input) {
    return {
      type: "empty",
    }
  }

  const resolvedCommand = appCommands
    .find((appCommand) => appCommand.identify(input))
    ?.resolve(input)

  if (resolvedCommand) {
    return resolvedCommand
  }

  return {
    type: "request",
    path: input.source,
  }
}

export const resolveQuickSwitchMode = (
  currentMode: TerminalMode,
): TerminalMode | null => {
  const currentIndex = quickSwitchModeSequence.indexOf(
    currentMode as (typeof quickSwitchModeSequence)[number],
  )

  if (currentIndex === -1) {
    return null
  }

  return (
    quickSwitchModeSequence[
      (currentIndex + 1) % quickSwitchModeSequence.length
    ] ?? null
  )
}
