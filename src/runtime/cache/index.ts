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
  // "<path> [<method>]", e.g. "/a/b/c [get]". Also the cache key, so the same
  // path called with different methods are stored as distinct entries.
  endpoint: string
  path: string
  method: string
  at: number
  durationMs: number
  request: ApiCallRequest
  response: ApiCallResponse
}

type RecordApiCallInput = Omit<ApiCallRecord, "endpoint" | "path" | "method">

const derivePath = (url: string | undefined): string => {
  if (!url) {
    return "(unknown)"
  }

  try {
    // A base handles relative URLs; absolute URLs ignore it.
    return new URL(url, "http://localhost").pathname || url
  } catch {
    return url
  }
}

/** Builds the "<path> [<method>]" endpoint label used as the cache key. */
export const formatEndpointLabel = (
  url: string | undefined,
  method: string | undefined,
): string => `${derivePath(url)} [${(method ?? "get").toLowerCase()}]`

type CacheHandles = {
  root: RootDatabase
  input: Database<InputRecord, string>
  api: Database<ApiCallRecord, string>
}

let handles: CacheHandles | null = null

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

/**
 * Records a successful API call, keyed by its "<path> [<method>]" endpoint so
 * the latest request/response for each endpoint+method is cached (a repeat call
 * overwrites the previous entry).
 */
export const recordApiCall = (record: RecordApiCallInput): void => {
  const cache = ensureOpen()

  if (!cache) {
    return
  }

  try {
    const method = (record.request.method ?? "get").toLowerCase()
    const path = derivePath(record.request.url)
    const endpoint = `${path} [${method}]`

    void cache.api.put(endpoint, { ...record, endpoint, path, method })
  } catch {
    // ignore cache write failures
  }
}

/** Returns all cached endpoints (one per path+method), in label order. */
export const listApiEndpoints = (): ApiCallRecord[] => {
  const cache = ensureOpen()

  if (!cache) {
    return []
  }

  try {
    const records: ApiCallRecord[] = []

    for (const { value } of cache.api.getRange()) {
      records.push(value)
    }

    return records
  } catch {
    return []
  }
}

/** Returns the cached call for an endpoint label, or undefined. */
export const getApiCall = (endpoint: string): ApiCallRecord | undefined => {
  const cache = ensureOpen()

  if (!cache) {
    return undefined
  }

  try {
    return cache.api.get(endpoint)
  } catch {
    return undefined
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
