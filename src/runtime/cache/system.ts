import { NS, cacheDelete, cacheGet, cachePut, openCache } from "./store.ts"

// One persisted AI agent session, stored in an array under a "<agent>-session"
// key in the system store. The array keeps every session for an agent in
// creation order (latest appended last).
export type AiSessionRecord = {
  // The agent's own session id, used to resume that conversation.
  id: string
  // ISO 8601 timestamp marking when the session was created.
  createdAt: string
  // ISO 8601 timestamp of the last time the session was used (resumed). Starts
  // equal to createdAt and is bumped by refreshAiSession; startup cleanup prunes
  // sessions by this value.
  updatedAt: string
}

// The system store holds runtime-related cache, keyed by a stable string. AI
// agent sessions live under "<agent>-session" (e.g. "claude-session",
// "codex-session", "cursor-session"); more keys may be added later.
const aiSessionKey = (agent: string): string => `${NS.system}${agent}-session`

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Keys whose value is an array of session records. Today every system key is a
// session array; the helper guards the type so the store can hold other shapes
// later without the cleanup mis-reading them.
const isSessionArray = (value: unknown): value is AiSessionRecord[] =>
  Array.isArray(value)

/**
 * Appends a newly-created AI session for an agent, stamped with the current ISO
 * time (createdAt and updatedAt start equal). The read-then-append is
 * synchronous, so it is atomic within the single-process event loop.
 *
 * Writes synchronously so one-shot CLI runs, which exit immediately, still
 * persist the entry.
 */
export const addAiSession = async (
  agent: string,
  id: string,
): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    const key = aiSessionKey(agent)
    const now = new Date().toISOString()
    const record: AiSessionRecord = { id, createdAt: now, updatedAt: now }

    const existing = (await cacheGet<AiSessionRecord[]>(cache, key)) ?? []
    cachePut(cache, key, [...existing, record])
  } catch {
    // ignore cache write failures
  }
}

/**
 * Bumps a session's updatedAt to now, marking it freshly used so startup
 * cleanup keeps it. No-op when the agent has no session with that id.
 *
 * Awaits the commit so a one-shot resume still persists the touch.
 */
export const refreshAiSession = async (
  agent: string,
  id: string,
): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    const key = aiSessionKey(agent)
    const existing = (await cacheGet<AiSessionRecord[]>(cache, key)) ?? []
    const now = new Date().toISOString()
    const updated = existing.map((record) =>
      record.id === id ? { ...record, updatedAt: now } : record,
    )

    cachePut(cache, key, updated)
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns every recorded session for an agent, in creation order (oldest
 * first). Empty when the agent has none.
 */
export const listAiSessions = async (
  agent: string,
): Promise<AiSessionRecord[]> => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    return (await cacheGet<AiSessionRecord[]>(cache, aiSessionKey(agent))) ?? []
  } catch {
    return []
  }
}

/**
 * Returns the most recently created session for an agent (the last appended),
 * or undefined when none exist — the entry to resume from.
 */
export const getLatestAiSession = async (
  agent: string,
): Promise<AiSessionRecord | undefined> => {
  const sessions = await listAiSessions(agent)

  return sessions[sessions.length - 1]
}

/**
 * Prunes AI sessions whose updatedAt has aged past `cleanupPeriodDays` from
 * every session key in the system store. A key whose sessions all expire is
 * removed. Best-effort: swallows failures so it can run during startup without
 * ever blocking boot.
 */
export const pruneExpiredAiSessions = async (
  cleanupPeriodDays: number,
): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    const cutoff = Date.now() - cleanupPeriodDays * MS_PER_DAY
    // prefixScan returns a snapshot array, so writes below don't disturb it.
    const keys = await cache.prefixScan(NS.system)

    for (const key of keys) {
      const sessions = await cacheGet<AiSessionRecord[]>(cache, key)

      if (!isSessionArray(sessions)) {
        continue
      }

      const kept = sessions.filter(
        (record) => Date.parse(record.updatedAt) >= cutoff,
      )

      if (kept.length === sessions.length) {
        continue
      }

      if (kept.length === 0) {
        cacheDelete(cache, key)
      } else {
        cachePut(cache, key, kept)
      }
    }
  } catch {
    // ignore cache cleanup failures
  }
}
