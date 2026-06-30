// Barrel for the best-effort embedded cache (ntee-db). Each handler lives in
// its own module and shares the single store opened by `openCache` (./store.ts).

export { formatEndpointLabel } from "./endpoint-label-helper.ts"
export { openCache } from "./store.ts"
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
