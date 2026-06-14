import { ModeAppCommand, TerminalMode } from "./base.ts"

export class HistoryCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@history", "@h"])
  protected readonly mode = TerminalMode.History
}
