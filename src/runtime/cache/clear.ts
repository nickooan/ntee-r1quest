import { openCache } from "./store.ts"

/** Clears all cached inputs and API history. */
export const clearCache = async (): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    await Promise.all([
      cache.input.clearAsync(),
      cache.api.clearAsync(),
      cache.trace.clearAsync(),
      cache.system.clearAsync(),
    ])
  } catch {
    // ignore cache clear failures
  }
}
