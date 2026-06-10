export enum TerminalMode {
  Query = "query",
  Search = "search",
  View = "view",
  Edit = "edit",
  Ai = "ai",
}

export type AppActionCommand = "exit" | "reload"

export type AppCommand =
  | {
      type: "mode"
      mode: TerminalMode
    }
  | {
      type: "app"
      command: AppActionCommand
    }
  | {
      type: "request"
      path: string
    }
  | {
      type: "empty"
    }

const queryModeCommands = new Set(["@query", "@q"])
const searchModeCommands = new Set(["@search", "@s"])
const viewModeCommands = new Set(["@view", "@v"])
const editModeCommands = new Set(["@edit", "@e"])
const aiModeCommands = new Set(["@ai", "@a"])
const appExitCommands = new Set(["@exit", "@quit"])
const appReloadCommands = new Set(["@reload"])

export const quickSwitchModeSequence = [
  TerminalMode.Query,
  TerminalMode.View,
  TerminalMode.Search,
  TerminalMode.Ai,
] as const

export const resolveAppCommand = (command: string): AppActionCommand | null => {
  if (appExitCommands.has(command)) {
    return "exit"
  }

  if (appReloadCommands.has(command)) {
    return "reload"
  }

  return null
}

export const isAppExitCommand = (command: string): boolean => {
  return resolveAppCommand(command) === "exit"
}

export const isAppReloadCommand = (command: string): boolean => {
  return resolveAppCommand(command) === "reload"
}

export const resolveModeCommand = (command: string): TerminalMode | null => {
  if (searchModeCommands.has(command)) {
    return TerminalMode.Search
  }

  if (viewModeCommands.has(command)) {
    return TerminalMode.View
  }

  if (editModeCommands.has(command)) {
    return TerminalMode.Edit
  }

  if (aiModeCommands.has(command)) {
    return TerminalMode.Ai
  }

  if (queryModeCommands.has(command)) {
    return TerminalMode.Query
  }

  return null
}

export const resolveAppInputCommand = (input: string): AppCommand => {
  const command = input.trim()

  if (!command) {
    return {
      type: "empty",
    }
  }

  const appCommand = resolveAppCommand(command)

  if (appCommand) {
    return {
      type: "app",
      command: appCommand,
    }
  }

  const mode = resolveModeCommand(command)

  if (mode) {
    return {
      type: "mode",
      mode,
    }
  }

  return {
    type: "request",
    path: command,
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
