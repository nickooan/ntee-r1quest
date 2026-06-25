import { useEffect, useState } from "react"
import { render, Text } from "ink"
import { indentBlock, sectionRule } from "./terminal/section-format.ts"
import type { ExecuteResult } from "../runtime/client/types.ts"

type HeaderValue = string | number | boolean | null | string[] | undefined
type ResponseHeaders = Record<string, unknown>

// Section-rule width used when a pane width is not supplied (e.g. one-shot
// output). Matches the history view's default so both read the same.
const defaultSectionWidth = 60
const pendingFrames = [".", "..", "..."]

// ── Header formatting ──────────────────────────────────────────────────────

const formatHeaderValue = (value: HeaderValue): string => {
  if (Array.isArray(value)) {
    return value.join(", ")
  }

  if (value === null || value === undefined) {
    return ""
  }

  return String(value)
}

export const formatResponseHeaders = (headers: ResponseHeaders): string =>
  Object.entries(headers)
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}: ${formatHeaderValue(value as HeaderValue)}`)
    .join("\n")

// ── Body formatting ────────────────────────────────────────────────────────

export const formatResponseBody = (body: unknown): string => {
  if (typeof body === "string") {
    return body
  }

  if (body === undefined) {
    return ""
  }

  if (body === null || typeof body === "number" || typeof body === "boolean") {
    return String(body)
  }

  return JSON.stringify(body, null, 2)
}

// ── Request description ─────────────────────────────────────────────────────

const formatRequestPath = (url?: string, baseURL?: string): string => {
  if (!url) {
    return "/"
  }

  try {
    const parsedUrl = baseURL ? new URL(url, baseURL) : new URL(url)

    return parsedUrl.pathname
  } catch {
    // Not a parseable URL: drop any query string and use what remains.
    return url.split("?")[0] ?? url
  }
}

// ── Output assembly ────────────────────────────────────────────────────────

/**
 * Renders a live response as a sectioned Results view matching the history
 * view: a `<path> [<METHOD>]` summary, the status (and trace id when present),
 * then Request and Response blocks with aligned fields and indented headers and
 * body. `width` sizes the section rules to the Result pane.
 */
export const formatResponse = (
  response: ExecuteResult,
  traceId?: string,
  width = defaultSectionWidth,
): string => {
  const method = String(response.request.method ?? "request").toUpperCase()
  const path = formatRequestPath(response.request.url, response.request.baseURL)
  const url = response.request.url ?? "(unknown)"
  const statusLine = `${response.status} ${response.statusText}`.trim()
  const headers = formatResponseHeaders(response.headers)
  const body = formatResponseBody(response.body)

  return [
    `${path} [${method}]`,
    statusLine,
    // The trace id (when present) sits under the status line, above Request.
    ...(traceId ? [`Trace: ${traceId}`] : []),
    "",
    sectionRule("Request", width),
    `URL     ${url}`,
    `Method  ${method}`,
    "",
    sectionRule("Response", width),
    `Status  ${statusLine}`,
    "",
    "Headers",
    indentBlock(headers === "" ? "(none)" : headers),
    "",
    "Body",
    indentBlock(body === "" ? "(empty)" : body),
  ].join("\n")
}

// Renders a true failure (no HTTP response) as an Error block. Responses with a
// status — including non-2xx — are converted to an ExecuteResult upstream and
// rendered via formatResponse, so they never reach here.
export const formatError = (
  error: unknown,
  _traceId?: string,
  width = defaultSectionWidth,
): string => {
  const message = error instanceof Error ? error.message : String(error)

  return [sectionRule("Error", width), "", message].join("\n")
}

// ── Pending indicator ──────────────────────────────────────────────────────

export const formatPending = (frameIndex: number): string => {
  const frame = pendingFrames[frameIndex % pendingFrames.length]

  return `pending${frame}`
}

export const PendingView = () => {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) => currentFrameIndex + 1)
    }, 250)

    return () => {
      clearInterval(interval)
    }
  }, [])

  return <Text>{formatPending(frameIndex)}</Text>
}

export const displayPending = () => {
  return render(<PendingView />)
}
