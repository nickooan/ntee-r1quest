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

  resolve(): AppCommand {
    return {
      type: "mode",
      mode: this.mode,
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
