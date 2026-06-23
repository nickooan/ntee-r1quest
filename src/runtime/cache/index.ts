// Barrel for the best-effort LMDB cache. Each handler lives in its own module
// and shares the single connection opened by `openCache` (./store.ts).

export { formatEndpointLabel } from "./endpoint.ts"
export { openCache, type CacheHandles } from "./store.ts"
export { recordInput, suggestInputs, type InputRecord } from "./input.ts"
export {
  recordApiCall,
  listApiEndpoints,
  getApiCall,
  type ApiCallRequest,
  type ApiCallResponse,
  type ApiCallRecord,
  type RecordApiCallInput,
} from "./api.ts"
export { listTraceCalls } from "./trace.ts"
export {
  addAiSession,
  refreshAiSession,
  listAiSessions,
  getLatestAiSession,
  pruneExpiredAiSessions,
  type AiSessionRecord,
} from "./system.ts"
export { clearCache } from "./clear.ts"
