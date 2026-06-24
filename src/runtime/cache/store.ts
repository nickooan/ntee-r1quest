import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { open as openLmdb, type Database, type RootDatabase } from "lmdb"
import { getHomeConfigDirectory } from "../config.ts"
import type { ApiCallRecord } from "./api.ts"
import type { InputRecord } from "./input.ts"
import type { AiSessionRecord } from "./system.ts"

export type CacheHandles = {
  root: RootDatabase
  input: Database<InputRecord, string>
  api: Database<ApiCallRecord, string>
  // traceId -> the calls made under it, in call order (latest appended last).
  trace: Database<ApiCallRecord[], string>
  // Runtime-related cache keyed by a stable string (e.g. "claude-session").
  // Typed for the AI session arrays it holds today; widen if other key shapes
  // are added. See ./system.ts for the typed accessors.
  system: Database<AiSessionRecord[], string>
}

let handles: CacheHandles | null = null

const getCacheDirectory = (): string => join(getHomeConfigDirectory(), "cache")

/**
 * Opens (once) and returns the LMDB cache handles, or null when the store can't
 * be opened. The result is memoized so every handler shares one connection.
 *
 * Cache is best-effort: it must never break the app, so an open failure is
 * swallowed and the caller simply degrades to a no-op.
 */
export const openCache = (): CacheHandles | null => {
  if (handles) {
    return handles
  }

  try {
    const directory = getCacheDirectory()
    mkdirSync(directory, { recursive: true })

    const root = openLmdb({ path: join(directory, "store.mdb") })

    handles = {
      root,
      input: root.openDB({ name: "inputHistory" }),
      api: root.openDB({ name: "apiHistory" }),
      trace: root.openDB({ name: "traceIndex" }),
      system: root.openDB({ name: "system" }),
    }

    return handles
  } catch {
    return null
  }
}
