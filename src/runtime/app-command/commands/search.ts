import { ModeAppCommand, TerminalMode } from "./base.ts"

export class SearchCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@search", "@s"])
  protected readonly mode = TerminalMode.Search
}
