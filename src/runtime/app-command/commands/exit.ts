import { ActionAppCommand } from "./base.ts"

export class ExitCommand extends ActionAppCommand {
  protected readonly aliases = new Set(["@exit", "@quit"])
  protected readonly command = "exit" as const
}
