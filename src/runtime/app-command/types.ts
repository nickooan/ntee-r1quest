export enum TerminalMode {
  Query = "query",
  Search = "search",
  View = "view",
  Edit = "edit",
  Ai = "ai",
  History = "history",
}

export type AppActionCommand = "exit" | "reload" | "clean-cache"

export type ParsedAppCommandInput = {
  source: string
  name: string
  args: string[]
}

export type AppCommand =
  | {
      type: "mode"
      mode: TerminalMode
      args?: string[]
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

export interface AppCommandDefinition {
  identify(input: ParsedAppCommandInput): boolean
  resolve(input: ParsedAppCommandInput): AppCommand
}
