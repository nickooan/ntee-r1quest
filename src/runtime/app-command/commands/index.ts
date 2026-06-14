import type { AppCommandDefinition } from "../types.ts"
import { AiCommand } from "./ai.ts"
import { EditCommand } from "./edit.ts"
import { ExitCommand } from "./exit.ts"
import { QueryCommand } from "./query.ts"
import { ReloadCommand } from "./reload.ts"
import { SearchCommand } from "./search.ts"
import { ViewCommand } from "./view.ts"

export const appCommands: AppCommandDefinition[] = [
  new QueryCommand(),
  new ViewCommand(),
  new EditCommand(),
  new SearchCommand(),
  new AiCommand(),
  new ExitCommand(),
  new ReloadCommand(),
]

export {
  AiCommand,
  EditCommand,
  ExitCommand,
  QueryCommand,
  ReloadCommand,
  SearchCommand,
  ViewCommand,
}
