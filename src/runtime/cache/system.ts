import { openCache } from "./store.ts"

// One persisted AI agent session, stored in an array under a "<agent>-session"
// key in the system store. The array keeps every session for an agent in
// creation order (latest appended last).
export type AiSessionRecord = {
  // The agent's own session id, used to resume that conversation.
  id: string
  // ISO 8601 timestamp marking when the session was created.
  createdAt: string
}

// The system store holds runtime-related cache, keyed by a stable string. AI
// agent sessions live under "<agent>-session" (e.g. "claude-session",
// "codex-session", "cursor-session"); more keys may be added later.
const aiSessionKey = (agent: string): string => `${agent}-session`

/**
 * Appends a newly-created AI session for an agent, stamped with the current ISO
 * time. The transaction makes the read-then-append atomic against concurrent
 * writers sharing the key.
 *
 * Awaits the LMDB commit so one-shot CLI runs, which exit immediately, still
 * persist the entry instead of losing the async write.
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
    const record: AiSessionRecord = { id, createdAt: new Date().toISOString() }

    await cache.system.transaction(() => {
      const existing = cache.system.get(key) ?? []
      cache.system.put(key, [...existing, record])
    })
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns every recorded session for an agent, in creation order (oldest
 * first). Empty when the agent has none.
 */
export const listAiSessions = (agent: string): AiSessionRecord[] => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    return cache.system.get(aiSessionKey(agent)) ?? []
  } catch {
    return []
  }
}

/**
 * Returns the most recently created session for an agent (the last appended),
 * or undefined when none exist — the entry to resume from.
 */
export const getLatestAiSession = (
  agent: string,
): AiSessionRecord | undefined => {
  const sessions = listAiSessions(agent)

  return sessions[sessions.length - 1]
}
