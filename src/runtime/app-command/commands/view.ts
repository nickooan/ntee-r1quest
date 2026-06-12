import { ModeAppCommand, TerminalMode } from "./base.ts"

export class ViewCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@view", "@v"])
  protected readonly mode = TerminalMode.View
}
