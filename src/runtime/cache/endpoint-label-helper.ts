// Pure helpers for deriving the endpoint label/key from a request (e.g.
// "/orders [get]" or "CreatePost [mutation]"). This is NOT a store — it just
// builds the string used as the api: cache key. Kept free of the store/native
// import so the label logic stays unit-testable without loading the native DB.

export const derivePath = (url: string | undefined): string => {
  if (!url) {
    return "(unknown)"
  }

  try {
    // A base handles relative URLs; absolute URLs ignore it.
    return new URL(url, "http://localhost").pathname || url
  } catch {
    return url
  }
}

// Detects a GraphQL request from its body (`{ query, operationName }`) and
// returns the operation type + name, so history can key/label it by operation
// (e.g. "CreatePost [mutation]") instead of the shared HTTP path.
const extractGraphqlOperation = (
  body: unknown,
): { type: string; name: string } | null => {
  let payload: unknown = body

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }

  if (!payload || typeof payload !== "object") {
    return null
  }

  const query = (payload as { query?: unknown }).query

  if (typeof query !== "string") {
    return null
  }

  // A named operation: "mutation CreatePost(...) {" / "query GetUser {".
  const named = query.match(
    /\b(query|mutation|subscription)\b\s+([A-Za-z_]\w*)/,
  )

  if (!named) {
    return null
  }

  const operationName = (payload as { operationName?: unknown }).operationName

  return {
    type: named[1] ?? "query",
    name:
      typeof operationName === "string" && operationName
        ? operationName
        : (named[2] ?? "operation"),
  }
}

/**
 * Builds the endpoint label used as the history cache key: "<operationName>
 * [<type>]" for GraphQL requests, otherwise "<path> [<method>]".
 */
export const formatEndpointLabel = (
  url: string | undefined,
  method: string | undefined,
  body?: unknown,
): string => {
  const graphql = extractGraphqlOperation(body)

  if (graphql) {
    return `${graphql.name} [${graphql.type}]`
  }

  return `${derivePath(url)} [${(method ?? "get").toLowerCase()}]`
}
