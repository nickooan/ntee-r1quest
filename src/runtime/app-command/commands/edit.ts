import { ModeAppCommand, TerminalMode } from "./base.ts"

export class EditCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@edit", "@e"])
  protected readonly mode = TerminalMode.Edit
}
