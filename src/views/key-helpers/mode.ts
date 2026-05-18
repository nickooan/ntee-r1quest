export enum TerminalMode {
  Query = "query",
  Search = "search",
  View = "view",
  Edit = "edit",
}

export const queryModeCommands = new Set(["@query", "@q"])
export const searchModeCommands = new Set(["@search", "@s"])
export const viewModeCommands = new Set(["@view", "@v"])
export const editModeCommands = new Set(["@edit", "@e"])

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

  if (queryModeCommands.has(command)) {
    return TerminalMode.Query
  }

  return null
}
