import { derivePath, formatEndpointLabel } from "./endpoint.ts"
import { openCache } from "./store.ts"

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

export type RecordApiCallInput = Omit<
  ApiCallRecord,
  "endpoint" | "path" | "method"
>

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
  const cache = openCache()

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

/** Returns all cached endpoints (one per path+method), in label order. */
export const listApiEndpoints = (): ApiCallRecord[] => {
  const cache = openCache()

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
  const cache = openCache()

  if (!cache) {
    return undefined
  }

  try {
    return cache.api.get(endpoint)
  } catch {
    return undefined
  }
}
