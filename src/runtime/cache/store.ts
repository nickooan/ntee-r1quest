import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { NteeDB } from "ntee-db"
import { getHomeConfigDirectory } from "../config.ts"

// The cache is a single embedded ntee-db store. Each kind of record lives under
// a key namespace. API calls are stored one-record-per-call keyed by a
// monotonic time id (NS.api + cacheId), with `endpoint` and `traceId` as
// secondary indexes — so nothing overwrites, `getApiCall` reads the latest via
// byIndex(..., -1), and `listTraceCalls` returns the whole trace collection.
export const NS = {
  input: "input:",
  api: "api:",
  system: "system:",
  versions: "versions:",
} as const

// Secondary indexes over API-call records.
export const ENDPOINT_INDEX = "endpoint"
export const TRACE_INDEX = "traceId"
// Secondary index over file-version snapshots (value = absolute file path). The
// cap keeps at most 50 snapshots per file, evicting the oldest (lowest key).
export const FILE_INDEX = "file"
export const MAX_VERSIONS_PER_FILE = 50

let store: NteeDB | null = null
let openFailed = false

const getCacheDirectory = (): string => join(getHomeConfigDirectory(), "cache")

/**
 * Opens (once) and returns the embedded cache store, or null when it can't be
 * opened. Memoized so every handler shares one connection.
 *
 * Cache is best-effort: it must never break the app, so an open failure is
 * swallowed and the caller simply degrades to a no-op.
 */
export const openCache = (): NteeDB | null => {
  if (store) {
    return store
  }

  if (openFailed) {
    return null
  }

  try {
    const directory = getCacheDirectory()
    mkdirSync(directory, { recursive: true })

    store = NteeDB.open(directory, {
      hintEveryN: 5,
      indexes: [
        { name: ENDPOINT_INDEX, kind: "string", maxPerValue: 5 },
        { name: TRACE_INDEX, kind: "string" },
        {
          name: FILE_INDEX,
          kind: "string",
          maxPerValue: MAX_VERSIONS_PER_FILE,
        },
      ],
    })

    return store
  } catch {
    openFailed = true
    return null
  }
}

/**
 * Closes the memoized cache store, releasing its single-writer lock so another
 * process can take ownership. The CLI entry process calls this after its
 * startup housekeeping, BEFORE launching the interactive TUI — the TUI's
 * runtime server is a separate process and must be able to acquire the lock,
 * or every history write in the session becomes a silent no-op. A later
 * openCache() in this process re-opens (and re-locks) on demand.
 */
export const closeCache = (): void => {
  try {
    store?.close()
  } catch {
    // best-effort: never let cache teardown break the app
  }
  store = null
  openFailed = false
}

/**
 * Reads a cache value, or undefined when absent/corrupt. ntee-db is a JSON
 * store, so get() already returns the parsed object; a Buffer here means a
 * non-JSON / corrupt value, treated as absent.
 */
export const cacheGet = async <T>(
  db: NteeDB,
  key: string,
): Promise<T | undefined> => {
  const value = await db.get(key)
  if (value == null || Buffer.isBuffer(value)) {
    return undefined
  }
  return value as T
}

/**
 * Stores a cache record (an object, JSON-serialized by ntee-db), optionally with
 * secondary index values (e.g. { traceId }).
 */
export const cachePut = (
  db: NteeDB,
  key: string,
  value: object,
  ix?: Record<string, string | number>,
): void => {
  db.put(key, value, ix) // ntee-db JSON-serializes the object
}

/** Deletes a cache key. */
export const cacheDelete = (db: NteeDB, key: string): void => {
  db.delete(key)
}
