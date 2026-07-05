import type { ApiCallRecord } from "./api.ts"
import { TRACE_INDEX, openCache } from "./store.ts"

/**
 * Returns every call recorded under a trace id, in call order (the order they
 * were made). Empty when the id is unknown.
 *
 * Each traced call is its own record carrying a `traceId` secondary index, so
 * this is a multi-value index lookup: the index returns all matching call
 * records (repeats included), in their key order — which is call order.
 */
export const listTraceCalls = (traceId: string): ApiCallRecord[] => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    const records: ApiCallRecord[] = []

    for (const { value } of cache.secIndexRecords(TRACE_INDEX, traceId)) {
      // JSON store: value is the parsed record; a Buffer/null means
      // corrupt or absent → skip.
      if (value == null || Buffer.isBuffer(value)) {
        continue
      }
      records.push(value as ApiCallRecord)
    }

    return records
  } catch {
    return []
  }
}
