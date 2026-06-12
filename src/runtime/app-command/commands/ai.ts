import { ModeAppCommand, TerminalMode } from "./base.ts"

export class AiCommand extends ModeAppCommand {
  protected readonly aliases = new Set(["@ai", "@a"])
  protected readonly mode = TerminalMode.Ai
}
