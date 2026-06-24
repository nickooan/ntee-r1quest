import type { ApiCallRecord } from "./api.ts"
import { openCache } from "./store.ts"

/**
 * Returns every call recorded under a trace id, in call order (the order they
 * were made). Empty when the id is unknown.
 */
export const listTraceCalls = (traceId: string): ApiCallRecord[] => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    return cache.trace.get(traceId) ?? []
  } catch {
    return []
  }
}
