export enum TerminalMode {
  Default = "default",
  Search = "search",
}

export const defaultModeCommands = new Set(["@default", "@q"])

export const resolveModeCommand = (command: string): TerminalMode | null => {
  if (command === "@search") {
    return TerminalMode.Search
  }

  if (defaultModeCommands.has(command)) {
    return TerminalMode.Default
  }

  return null
}
