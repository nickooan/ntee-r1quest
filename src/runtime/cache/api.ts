import {
  ENDPOINT_INDEX,
  NS,
  TRACE_INDEX,
  cacheGet,
  cachePut,
  openCache,
} from "./store.ts"
import { derivePath, formatEndpointLabel } from "./endpoint-label-helper.ts"

// cacheId is a monotonic unix-ms id: the wall clock when possible, nudged
// forward by 1 when two calls land in the same millisecond so every record has
// a unique, strictly-increasing id (= insertion/call order).
let lastCacheId = 0

const nextCacheId = (): number => {
  const now = Date.now()
  lastCacheId = now > lastCacheId ? now : lastCacheId + 1
  return lastCacheId
}

// Each API call is its own record keyed by its cacheId (zero-padded so keys
// sort in time order); `endpoint`/`traceId` are secondary indexes.
const apiKey = (cacheId: number): string =>
  `${NS.api}${String(cacheId).padStart(16, "0")}`

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
  // "<path> [<method>]", e.g. "/a/b/c [get]". A secondary index, so the same
  // path called with different methods are distinct groups.
  endpoint: string
  path: string
  method: string
  // Optional batch/task id (CLI `-ti`). A secondary index, so all calls sharing
  // the id can be listed in order via the trace index.
  traceId?: string
  // Monotonic unix-ms id assigned when the call was cached; also the record's
  // primary key. Unique and strictly increasing (= call order).
  cacheId: number
  at: number
  durationMs: number
  request: ApiCallRequest
  response: ApiCallResponse
}

export type RecordApiCallInput = Omit<
  ApiCallRecord,
  "endpoint" | "path" | "method" | "cacheId"
>

/**
 * Records a successful API call as its own time-keyed record (key = cacheId),
 * with `endpoint` and `traceId` as secondary indexes. Nothing is overwritten —
 * an untraced call never clobbers a previous traced call to the same endpoint.
 *
 * Writes synchronously to the append-only log so one-shot CLI runs, which exit
 * immediately after the request, still persist the entry. (Kept async to
 * preserve the call signature.)
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

    const cacheId = nextCacheId()
    const fullRecord: ApiCallRecord = {
      ...record,
      endpoint,
      path,
      method,
      cacheId,
    }

    const ix: Record<string, string> = { [ENDPOINT_INDEX]: endpoint }
    if (fullRecord.traceId) {
      ix[TRACE_INDEX] = fullRecord.traceId
    }

    cachePut(cache, apiKey(cacheId), fullRecord, ix)
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns the latest cached call per endpoint (one row each), in label order —
 * the History list. Derived by deduping the per-call records to the most recent
 * per endpoint.
 */
export const listApiEndpoints = async (): Promise<ApiCallRecord[]> => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    // Records come back in key (cacheId / call) order, so the last seen per
    // endpoint is the latest.
    const latest = new Map<string, ApiCallRecord>()

    for (const { value } of await cache.prefixScanRecords(NS.api)) {
      // JSON store: value is the parsed record; skip corrupt/absent.
      if (value == null || Buffer.isBuffer(value)) {
        continue
      }
      const record = value as ApiCallRecord
      latest.set(record.endpoint, record)
    }

    return [...latest.values()].sort((left, right) =>
      left.endpoint < right.endpoint
        ? -1
        : left.endpoint > right.endpoint
          ? 1
          : 0,
    )
  } catch {
    return []
  }
}

/**
 * Like {@link listApiEndpoints}, but only endpoints whose label starts with
 * `prefix` — the latest call per matching endpoint, in label order.
 *
 * Uses the `endpoint` secondary index with a grouped `-1` limit, so the store
 * returns exactly the most-recent record for each matching endpoint (a
 * binary-search-bounded walk) instead of scanning every `api:` record.
 */
export const listApiEndpointsByPrefix = async (
  prefix: string,
): Promise<ApiCallRecord[]> => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    const records: ApiCallRecord[] = []

    // -1 → the single most-recent record of each endpoint under the prefix,
    // already grouped and ordered by endpoint label.
    for (const { value } of await cache.secIndexPrefixRecords(
      ENDPOINT_INDEX,
      prefix,
      -1,
    )) {
      // JSON store: value is the parsed record; skip corrupt/absent.
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

/** Returns the latest cached call for an endpoint label, or undefined. */
export const getApiCall = async (
  endpoint: string,
): Promise<ApiCallRecord | undefined> => {
  const cache = openCache()

  if (!cache) {
    return undefined
  }

  try {
    // -1 → the single most-recent record for this endpoint.
    const [key] = await cache.secIndex(ENDPOINT_INDEX, endpoint, -1)

    return key ? await cacheGet<ApiCallRecord>(cache, key) : undefined
  } catch {
    return undefined
  }
}
