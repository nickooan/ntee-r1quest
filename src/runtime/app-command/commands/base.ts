import type {
  AppActionCommand,
  AppCommand,
  AppCommandDefinition,
  ParsedAppCommandInput,
} from "../types.ts"
import { TerminalMode } from "../types.ts"

export abstract class AliasAppCommand implements AppCommandDefinition {
  protected abstract readonly aliases: Set<string>

  identify(input: ParsedAppCommandInput): boolean {
    return this.aliases.has(input.name)
  }

  abstract resolve(input: ParsedAppCommandInput): AppCommand
}

export abstract class ModeAppCommand extends AliasAppCommand {
  protected abstract readonly mode: TerminalMode

  resolve(input: ParsedAppCommandInput): AppCommand {
    return {
      type: "mode",
      mode: this.mode,
      // Trailing text after the alias (e.g. `@s uuid`) is carried as args so a
      // mode like search can act on it immediately. Omitted when empty so
      // arg-less commands keep their plain `{ type, mode }` shape.
      args: input.args.length > 0 ? input.args : undefined,
    }
  }
}

export abstract class ActionAppCommand extends AliasAppCommand {
  protected abstract readonly command: AppActionCommand

  resolve(): AppCommand {
    return {
      type: "app",
      command: this.command,
    }
  }
}

export { TerminalMode }
