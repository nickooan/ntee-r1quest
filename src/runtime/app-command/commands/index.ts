import type { AppCommandDefinition } from "../types.ts"
import { AiCommand } from "./ai.ts"
import { CleanCacheCommand } from "./clean-cache.ts"
import { EditCommand } from "./edit.ts"
import { ExitCommand } from "./exit.ts"
import { HistoryCommand } from "./history.ts"
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
  new CleanCacheCommand(),
  new HistoryCommand(),
]

export {
  AiCommand,
  CleanCacheCommand,
  EditCommand,
  ExitCommand,
  HistoryCommand,
  QueryCommand,
  ReloadCommand,
  SearchCommand,
  ViewCommand,
}
