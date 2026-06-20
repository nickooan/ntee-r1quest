import { ActionAppCommand } from "./base.ts"

/** Copies the Result pane content to the system clipboard. */
export class CopyReportCommand extends ActionAppCommand {
  protected readonly aliases = new Set(["@report", "@copy"])
  protected readonly command = "copy-report" as const
}
