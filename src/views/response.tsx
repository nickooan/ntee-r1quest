import { isAxiosError, type AxiosResponse } from "axios"
import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from "axios"
import React from "react"
import { useEffect, useState } from "react"
import { render, Text } from "ink"

type HeaderValue = string | number | boolean | null | string[] | undefined

type ResponseHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders
const pendingFrames = [".", "..", "..."]
const sectionBorder = "---------------"
const headersSection = `${sectionBorder} Headers ${sectionBorder}`
const bodySection = `${sectionBorder} Body ${sectionBorder}`
const errorSection = `${sectionBorder} Error ${sectionBorder}`

const formatSectionTitle = (title: string): string => {
  return `${sectionBorder} ${title} ${sectionBorder}`
}

const formatHeaderValue = (value: HeaderValue): string => {
  if (Array.isArray(value)) {
    return value.join(", ")
  }

  if (value === null || value === undefined) {
    return ""
  }

  return String(value)
}

export const formatPending = (frameIndex: number): string => {
  const frame = pendingFrames[frameIndex % pendingFrames.length]

  return `pending${frame}`
}

export const formatResponseHeaders = (headers: ResponseHeaders): string => {
  const lines = Object.entries(headers)
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}: ${formatHeaderValue(value as HeaderValue)}`)

  return lines.join("\n")
}

export const formatResponseBody = (
  body: AxiosResponse["data"],
  contentType?: string,
): string => {
  if (typeof body === "string") {
    return body
  }

  if (body === undefined) {
    return ""
  }

  if (body === null || typeof body === "number" || typeof body === "boolean") {
    return String(body)
  }

  if (!contentType) {
    return JSON.stringify(body, null, 2)
  }

  return JSON.stringify(body, null, 2)
}

const formatRequestPath = (url?: string, baseURL?: string): string => {
  if (!url) {
    return "/"
  }

  try {
    const parsedUrl = baseURL ? new URL(url, baseURL) : new URL(url)

    return parsedUrl.pathname
  } catch {
    return url.split("?")[0] ?? url
  }
}

const formatRequestDescription = (response: AxiosResponse): string => {
  const method = String(response.config.method ?? "request").toLowerCase()
  const path = formatRequestPath(response.config.url, response.config.baseURL)

  return `${method} ${path}`
}

export const formatResponse = (response: AxiosResponse): string => {
  const statusLine = `${response.status} ${response.statusText}`.trim()
  const contentType = String(response.headers["content-type"] ?? "")
  const headers = formatResponseHeaders(response.headers)
  const body = formatResponseBody(response.data, contentType)
  const requestDescription = formatRequestDescription(response)

  const output = [
    formatSectionTitle(`Response of ${requestDescription}`),
    "",
    statusLine,
    "",
    headersSection,
    "",
    headers,
    "",
    bodySection,
    "",
    body,
    "",
    formatSectionTitle(`End of ${requestDescription}`),
  ]
    .filter((section, index, sections) => {
      if (section !== "") {
        return true
      }

      const previousSection = sections[index - 1]
      const nextSection = sections[index + 1]

      return previousSection !== "" && nextSection !== ""
    })
    .join("\n")

  return `${output}\n`
}

export const formatError = (error: unknown): string => {
  if (isAxiosError(error) && error.response) {
    return formatResponse(error.response)
  }

  const message = error instanceof Error ? error.message : String(error)

  return [errorSection, "", message].join("\n")
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
