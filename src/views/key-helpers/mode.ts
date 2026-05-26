export enum TerminalMode {
  Query = "query",
  Search = "search",
  View = "view",
  Edit = "edit",
  Ai = "ai",
}

export const queryModeCommands = new Set(["@query", "@q"])
export const searchModeCommands = new Set(["@search", "@s"])
export const viewModeCommands = new Set(["@view", "@v"])
export const editModeCommands = new Set(["@edit", "@e"])
export const aiModeCommands = new Set(["@ai", "@a"])
export const appExitCommands = new Set(["@exit", "@quit"])
export const quickSwitchModeSequence = [
  TerminalMode.Query,
  TerminalMode.View,
  TerminalMode.Search,
  TerminalMode.Ai,
] as const

export const isAppExitCommand = (command: string): boolean => {
  return appExitCommands.has(command)
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
