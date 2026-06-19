import type { ApiCallRecord } from "../../runtime/cache/index.ts"

const indentBlock = (text: string, pad = "  "): string =>
  text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n")

// Pretty-prints a header/body value: JSON objects (or JSON-looking strings) are
// indented, everything else is shown as-is.
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") {
    return "(empty)"
  }

  if (typeof value === "string") {
    const trimmed = value.trim()

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        // not valid JSON, fall through to the raw string
      }
    }

    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatHeaders = (headers: Record<string, unknown>): string => {
  const entries = Object.entries(headers ?? {})

  if (entries.length === 0) {
    return "(none)"
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join("\n")
}

const sectionRule = (label: string, width: number): string => {
  const prefix = `── ${label} `
  return prefix + "─".repeat(Math.max(3, width - prefix.length))
}

/**
 * Renders a cached API call as a clear, sectioned Results view: a summary line,
 * then Request and Response blocks with aligned fields and pretty-printed
 * headers and bodies.
 */
export const formatHistoryEntry = (
  record: ApiCallRecord,
  width = 60,
): string => {
  const method = record.method.toUpperCase()

  return [
    // The endpoint label (GraphQL operation, or "<path> [<method>]").
    record.endpoint,
    `${record.response.status}  ·  ${record.durationMs} ms`,
    // The trace id (when present) sits under the status/duration line and above
    // the Request section.
    ...(record.traceId ? [`Trace: ${record.traceId}`] : []),
    "",
    sectionRule("Request", width),
    `URL     ${record.request.url ?? "(unknown)"}`,
    `Method  ${method}`,
    "",
    "Headers",
    indentBlock(formatHeaders(record.request.headers)),
    "",
    "Body",
    indentBlock(formatValue(record.request.body)),
    "",
    sectionRule("Response", width),
    `Status  ${record.response.status}`,
    "",
    "Headers",
    indentBlock(formatHeaders(record.response.headers)),
    "",
    "Body",
    indentBlock(formatValue(record.response.data)),
  ].join("\n")
}
