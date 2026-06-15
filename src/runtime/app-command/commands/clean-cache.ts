import { ActionAppCommand } from "./base.ts"

export class CleanCacheCommand extends ActionAppCommand {
  protected readonly aliases = new Set(["@clean-cache", "@cc"])
  protected readonly command = "clean-cache" as const
}
