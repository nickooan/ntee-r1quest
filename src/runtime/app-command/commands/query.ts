import { ModeAppCommand, TerminalMode } from "./base.ts"

export class QueryCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@query", "@q"])
  protected readonly mode = TerminalMode.Query
}
