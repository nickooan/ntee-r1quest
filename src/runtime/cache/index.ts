import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { open, type Database, type RootDatabase } from "lmdb"
import { getHomeConfigDirectory } from "../config.ts"

type InputRecord = {
  count: number
  lastUsedAt: number
}

export type ApiCallRequest = {
  url?: string
  method?: string
  headers: Record<string, unknown>
  body?: unknown
}

export type ApiCallResponse = {
  status: number
  headers: Record<string, unknown>
  data: unknown
}

export type ApiCallRecord = {
  at: number
  durationMs: number
  request: ApiCallRequest
  response: ApiCallResponse
}

type CacheHandles = {
  root: RootDatabase
  input: Database<InputRecord, string>
  api: Database<ApiCallRecord, string>
}

let handles: CacheHandles | null = null
let apiSequence = 0

// Cache is best-effort: it must never break the app, so opens and writes that
// fail are swallowed and the feature simply degrades to a no-op.
const getCacheDirectory = (): string => join(getHomeConfigDirectory(), "cache")

const ensureOpen = (): CacheHandles | null => {
  if (handles) {
    return handles
  }

  try {
    const directory = getCacheDirectory()
    mkdirSync(directory, { recursive: true })

    const root = open({ path: join(directory, "store.mdb") })

    handles = {
      root,
      input: root.openDB({ name: "inputHistory" }),
      api: root.openDB({ name: "apiHistory" }),
    }

    return handles
  } catch {
    return null
  }
}

// Inputs prefixed with "@" are mode/app commands and are intentionally not
// cached.
const isCacheableInput = (input: string): boolean =>
  input.length > 0 && !input.startsWith("@")

/**
 * Records a user input in the shared query/view history. Dedupes by text,
 * bumping a usage count and recency timestamp. No-op for empty input or
 * "@" commands.
 */
export const recordInput = (rawInput: string): void => {
  const input = rawInput.trim()

  if (!isCacheableInput(input)) {
    return
  }

  const cache = ensureOpen()

  if (!cache) {
    return
  }

  try {
    const existing = cache.input.get(input)

    void cache.input.put(input, {
      count: (existing?.count ?? 0) + 1,
      lastUsedAt: Date.now(),
    })
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns cached inputs that start with the given prefix, most-recently-used
 * first. Prefix matching uses LMDB's ordered keys for an efficient range scan.
 */
export const suggestInputs = (prefix: string, limit = 6): string[] => {
  const normalizedPrefix = prefix.trim()

  if (!isCacheableInput(normalizedPrefix)) {
    return []
  }

  const cache = ensureOpen()

  if (!cache) {
    return []
  }

  try {
    const matches: Array<{ key: string; lastUsedAt: number }> = []

    for (const { key, value } of cache.input.getRange({
      start: normalizedPrefix,
    })) {
      const keyString = String(key)

      if (!keyString.startsWith(normalizedPrefix)) {
        break
      }

      // Skip an exact match of what the user already typed.
      if (keyString !== normalizedPrefix) {
        matches.push({ key: keyString, lastUsedAt: value.lastUsedAt })
      }
    }

    return matches
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, limit)
      .map((match) => match.key)
  } catch {
    return []
  }
}

/** Records a successful API call with its request and response details. */
export const recordApiCall = (record: ApiCallRecord): void => {
  const cache = ensureOpen()

  if (!cache) {
    return
  }

  try {
    // Keys are time-ordered; a sequence suffix keeps calls within the same
    // millisecond distinct and stably ordered.
    apiSequence = (apiSequence + 1) % 1_000_000
    const key = `${record.at.toString().padStart(16, "0")}-${apiSequence
      .toString()
      .padStart(6, "0")}`

    void cache.api.put(key, record)
  } catch {
    // ignore cache write failures
  }
}

/** Returns recorded API calls, most recent first. */
export const listApiHistory = (limit = 100): ApiCallRecord[] => {
  const cache = ensureOpen()

  if (!cache) {
    return []
  }

  try {
    const records: ApiCallRecord[] = []

    for (const { value } of cache.api.getRange({ reverse: true })) {
      records.push(value)

      if (records.length >= limit) {
        break
      }
    }

    return records
  } catch {
    return []
  }
}

/** Clears all cached inputs and API history. */
export const clearCache = async (): Promise<void> => {
  const cache = ensureOpen()

  if (!cache) {
    return
  }

  try {
    await Promise.all([cache.input.clearAsync(), cache.api.clearAsync()])
  } catch {
    // ignore cache clear failures
  }
}
