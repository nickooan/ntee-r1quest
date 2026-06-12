import { ActionAppCommand } from "./base.ts"

export class ReloadCommand extends ActionAppCommand {
  protected readonly aliases = new Set(["@reload"])
  protected readonly command = "reload" as const
}
