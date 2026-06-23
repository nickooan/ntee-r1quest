import { pruneExpiredAiSessions } from "./cache/index.ts"
import type { RuntimeConfig } from "./config.ts"

/**
 * Runtime "before action" run once at app start, ahead of the UI rendering.
 * Currently prunes AI sessions whose updatedAt has aged past the configured
 * cleanup period so resume lists never offer dead sessions.
 *
 * Best-effort: the underlying cache calls never throw, so this can be awaited
 * during boot without risk of blocking the app. Views should reference this
 * rather than reimplementing the cleanup.
 */
export const runStartupBeforeActions = async (
  config: RuntimeConfig,
): Promise<void> => {
  await pruneExpiredAiSessions(config.sessionCleanupPeriod)
}
