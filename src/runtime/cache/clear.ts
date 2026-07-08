import { openCache } from "./store.ts"

/** Clears all cached inputs and API history. */
export const clearCache = async (): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    // Delete every key across all namespaces, then reclaim the dead records.
    for (const key of await cache.prefixScan("")) {
      cache.delete(key)
    }

    await cache.compact()
  } catch {
    // ignore cache clear failures
  }
}
