import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { open, type Database, type RootDatabase } from "lmdb"
import { getHomeConfigDirectory } from "../config.ts"
import { derivePath, formatEndpointLabel } from "./endpoint.ts"

export { formatEndpointLabel } from "./endpoint.ts"

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
  // Optional batch/task id (CLI `-ti`). When set, the record is also appended
  // to the trace index so all calls sharing the id can be listed in order.
  traceId?: string
  at: number
  durationMs: number
  request: ApiCallRequest
  response: ApiCallResponse
}

type RecordApiCallInput = Omit<ApiCallRecord, "endpoint" | "path" | "method">

type CacheHandles = {
  root: RootDatabase
  input: Database<InputRecord, string>
  api: Database<ApiCallRecord, string>
  // traceId -> the calls made under it, in call order (latest appended last).
  trace: Database<ApiCallRecord[], string>
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
      trace: root.openDB({ name: "traceIndex" }),
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
 * Records a successful API call, keyed by its "<path> [<method>]" endpoint (or
 * "<operation> [<type>]" for GraphQL) so the latest request/response for each
 * endpoint is cached (a repeat call overwrites the previous entry).
 *
 * Awaits the LMDB commit so one-shot CLI runs, which exit immediately after the
 * request, still persist the entry instead of losing the async write.
 */
export const recordApiCall = async (
  record: RecordApiCallInput,
): Promise<void> => {
  const cache = ensureOpen()

  if (!cache) {
    return
  }

  try {
    const method = (record.request.method ?? "get").toLowerCase()
    const path = derivePath(record.request.url)
    const endpoint = formatEndpointLabel(
      record.request.url,
      record.request.method,
      record.request.body,
    )

    const fullRecord: ApiCallRecord = { ...record, endpoint, path, method }

    await cache.api.put(endpoint, fullRecord)

    // When a trace id is supplied, append this call to the end of its index
    // entry so the trace keeps every call (including endpoint repeats) in call
    // order. The transaction makes the read-then-append atomic against
    // concurrent calls sharing the same id.
    const { traceId } = fullRecord

    if (traceId) {
      await cache.trace.transaction(() => {
        const existing = cache.trace.get(traceId) ?? []
        cache.trace.put(traceId, [...existing, fullRecord])
      })
    }
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns every call recorded under a trace id, in call order (the order they
 * were made). Empty when the id is unknown.
 */
export const listTraceCalls = (traceId: string): ApiCallRecord[] => {
  const cache = ensureOpen()

  if (!cache) {
    return []
  }

  try {
    return cache.trace.get(traceId) ?? []
  } catch {
    return []
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
    await Promise.all([
      cache.input.clearAsync(),
      cache.api.clearAsync(),
      cache.trace.clearAsync(),
    ])
  } catch {
    // ignore cache clear failures
  }
}
