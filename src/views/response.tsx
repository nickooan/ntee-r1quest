import { isAxiosError, type AxiosResponse } from "axios"
import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from "axios"
import { useEffect, useState } from "react"
import { render, Text } from "ink"

type HeaderValue = string | number | boolean | null | string[] | undefined
type ResponseHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders

const sectionBorder = "---------------"
const pendingFrames = [".", "..", "..."]

// A section divider, e.g. "--------------- Headers ---------------".
const formatSectionTitle = (title: string): string =>
  `${sectionBorder} ${title} ${sectionBorder}`

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

export const formatResponseBody = (body: AxiosResponse["data"]): string => {
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

const formatRequestDescription = (response: AxiosResponse): string => {
  const method = String(response.config.method ?? "request").toLowerCase()
  const path = formatRequestPath(response.config.url, response.config.baseURL)

  return `${method} ${path}`
}

// ── Output assembly ────────────────────────────────────────────────────────

// Joins the given blocks with a single blank line between each, dropping any
// empty block (e.g. a body-less 204 or a response with no headers).
const joinSections = (sections: string[]): string =>
  sections.filter((section) => section !== "").join("\n\n")

export const formatResponse = (
  response: AxiosResponse,
  traceId?: string,
): string => {
  const requestDescription = formatRequestDescription(response)
  const statusLine = `${response.status} ${response.statusText}`.trim()
  const headers = formatResponseHeaders(response.headers)
  const body = formatResponseBody(response.data)

  // When the request was tagged with a trace id, show it as the last line of
  // the status section — below the status line, above the Headers section.
  const statusSection = traceId
    ? `${statusLine}\nTrace: ${traceId}`
    : statusLine

  const output = joinSections([
    formatSectionTitle(`Response of ${requestDescription}`),
    statusSection,
    formatSectionTitle("Headers"),
    headers,
    formatSectionTitle("Body"),
    body,
    formatSectionTitle(`End of ${requestDescription}`),
  ])

  return `${output}\n`
}

export const formatError = (error: unknown, traceId?: string): string => {
  // An axios error with a response is shown as a normal response view.
  if (isAxiosError(error) && error.response) {
    return formatResponse(error.response, traceId)
  }

  const message = error instanceof Error ? error.message : String(error)

  return joinSections([formatSectionTitle("Error"), message])
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
