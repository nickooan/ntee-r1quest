import { closeCache, pruneExpiredAiSessions } from "./cache/index.ts"
import type { RuntimeConfig } from "./config.ts"

/**
 * Startup housekeeping the CLI entry process runs once, before the UI boots.
 * It borrows the cache for the duration of this call — open, prune AI
 * sessions whose updatedAt has aged past the configured cleanup period (so
 * resume lists never offer dead sessions), close — and the close is part of
 * the contract, not cleanup: opening the cache takes its single-writer lock,
 * while the session's history is written by the TUI's runtime server in a
 * separate process. Whichever process holds the lock owns the store, so this
 * function must always hand it back before the TUI launches; anything added
 * here later must keep that shape (do cache work, then release).
 *
 * Best-effort: the underlying cache calls never throw, so this can be awaited
 * during boot without risk of blocking the app. Views should reference this
 * rather than reimplementing the cleanup.
 */
export const runStartupBeforeActions = async (
  config: RuntimeConfig,
): Promise<void> => {
  await pruneExpiredAiSessions(config.sessionCleanupPeriod)
  closeCache()
}
