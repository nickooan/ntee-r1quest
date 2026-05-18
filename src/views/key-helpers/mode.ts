export enum TerminalMode {
  Query = "query",
  Search = "search",
}

export const queryModeCommands = new Set(["@query", "@q"])
export const searchModeCommands = new Set(["@search", "@s"])

export const resolveModeCommand = (command: string): TerminalMode | null => {
  if (searchModeCommands.has(command)) {
    return TerminalMode.Search
  }

  if (queryModeCommands.has(command)) {
    return TerminalMode.Query
  }

  return null
}
