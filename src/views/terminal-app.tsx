import type { AxiosResponse } from "axios"
import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, render, useInput } from "ink"
import { formatError, formatPending, formatResponse } from "./response.tsx"

export type TerminalAppProps = {
  response?: AxiosResponse
  error?: unknown
  isPending?: boolean
  height?: number
  width?: number
  prompt?: string
  onCommand?: (command: string) => void
}

type Viewport = {
  lines: string[]
  maxScrollX: number
  maxScrollY: number
}

const defaultHeight = 20
const defaultWidth = 80
const commandLineHeight = 1
const horizontalScrollbarHeight = 1
const verticalScrollbarWidth = 1
const scrollbarThumb = "#"
const scrollbarTrack = "-"
const verticalScrollbarTrack = "|"

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

const normalizeLines = (content: string): string[] => {
  return content.split("\n")
}

const sliceLine = (line: string, scrollX: number, width: number): string => {
  return line.slice(scrollX, scrollX + width).padEnd(width, " ")
}

const isThumbPosition = (
  index: number,
  visibleSize: number,
  contentSize: number,
  scrollOffset: number,
): boolean => {
  if (contentSize <= visibleSize) {
    return true
  }

  const thumbSize = Math.max(1, Math.floor((visibleSize / contentSize) * visibleSize))
  const maxThumbStart = visibleSize - thumbSize
  const maxScroll = contentSize - visibleSize
  const thumbStart = Math.round((scrollOffset / maxScroll) * maxThumbStart)

  return index >= thumbStart && index < thumbStart + thumbSize
}

const formatTerminalContent = ({
  response,
  error,
  isPending,
  frameIndex,
}: Pick<TerminalAppProps, "response" | "error" | "isPending"> & {
  frameIndex: number
}): string => {
  if (isPending) {
    return formatPending(frameIndex)
  }

  if (error !== undefined) {
    return formatError(error)
  }

  if (response) {
    return formatResponse(response)
  }

  return ""
}

export const buildTerminalViewport = (
  content: string,
  width: number,
  height: number,
  scrollX: number,
  scrollY: number,
): Viewport => {
  const lines = normalizeLines(content)
  const maxLineWidth = lines.reduce(
    (currentMax, line) => Math.max(currentMax, line.length),
    0,
  )
  const maxScrollX = Math.max(0, maxLineWidth - width)
  const maxScrollY = Math.max(0, lines.length - height)
  const safeScrollX = clamp(scrollX, 0, maxScrollX)
  const safeScrollY = clamp(scrollY, 0, maxScrollY)
  const visibleLines = lines
    .slice(safeScrollY, safeScrollY + height)
    .map((line) => sliceLine(line, safeScrollX, width))

  while (visibleLines.length < height) {
    visibleLines.push(" ".repeat(width))
  }

  return {
    lines: visibleLines,
    maxScrollX,
    maxScrollY,
  }
}

const buildHorizontalScrollbar = (
  width: number,
  contentWidth: number,
  scrollX: number,
): string => {
  return Array.from({ length: width }, (_, index) =>
    isThumbPosition(index, width, contentWidth, scrollX)
      ? scrollbarThumb
      : scrollbarTrack,
  ).join("")
}

export const TerminalApp = ({
  response,
  error,
  isPending = false,
  height = defaultHeight,
  width = defaultWidth,
  prompt = ":",
  onCommand,
}: TerminalAppProps) => {
  const [frameIndex, setFrameIndex] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  const [command, setCommand] = useState("")
  const viewHeight = Math.max(1, height - commandLineHeight - horizontalScrollbarHeight)
  const viewWidth = Math.max(1, width - verticalScrollbarWidth)
  const content = formatTerminalContent({
    response,
    error,
    isPending,
    frameIndex,
  })
  const contentLines = useMemo(() => normalizeLines(content), [content])
  const contentWidth = useMemo(
    () =>
      contentLines.reduce((currentMax, line) => Math.max(currentMax, line.length), 0),
    [contentLines],
  )
  const viewport = buildTerminalViewport(content, viewWidth, viewHeight, scrollX, scrollY)
  const safeScrollX = clamp(scrollX, 0, viewport.maxScrollX)
  const safeScrollY = clamp(scrollY, 0, viewport.maxScrollY)

  useEffect(() => {
    if (!isPending) {
      return
    }

    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) => currentFrameIndex + 1)
    }, 250)

    return () => {
      clearInterval(interval)
    }
  }, [isPending])

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollY((currentScrollY) => clamp(currentScrollY - 1, 0, viewport.maxScrollY))
      return
    }

    if (key.downArrow) {
      setScrollY((currentScrollY) => clamp(currentScrollY + 1, 0, viewport.maxScrollY))
      return
    }

    if (key.leftArrow) {
      setScrollX((currentScrollX) => clamp(currentScrollX - 1, 0, viewport.maxScrollX))
      return
    }

    if (key.rightArrow) {
      setScrollX((currentScrollX) => clamp(currentScrollX + 1, 0, viewport.maxScrollX))
      return
    }

    if (key.pageUp) {
      setScrollY((currentScrollY) =>
        clamp(currentScrollY - viewHeight, 0, viewport.maxScrollY),
      )
      return
    }

    if (key.pageDown) {
      setScrollY((currentScrollY) =>
        clamp(currentScrollY + viewHeight, 0, viewport.maxScrollY),
      )
      return
    }

    if (key.home) {
      setScrollX(0)
      setScrollY(0)
      return
    }

    if (key.end) {
      setScrollX(viewport.maxScrollX)
      setScrollY(viewport.maxScrollY)
      return
    }

    if (key.backspace || key.delete) {
      setCommand((currentCommand) => currentCommand.slice(0, -1))
      return
    }

    if (key.return) {
      onCommand?.(command)
      setCommand("")
      return
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return
    }

    if (input) {
      setCommand((currentCommand) => `${currentCommand}${input}`)
    }
  })

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexDirection="column" width={width} height={viewHeight}>
        {viewport.lines.map((line, index) => (
          <Box key={`${safeScrollY}-${index}`} width={width}>
            <Text wrap="truncate-end">{line}</Text>
            <Text>
              {isThumbPosition(index, viewHeight, contentLines.length, safeScrollY)
                ? scrollbarThumb
                : verticalScrollbarTrack}
            </Text>
          </Box>
        ))}
      </Box>
      <Text>
        {buildHorizontalScrollbar(viewWidth, contentWidth, safeScrollX)}
        {verticalScrollbarTrack}
      </Text>
      <Box width={width}>
        <Text>{prompt}</Text>
        <Text>{command}</Text>
        <Text inverse> </Text>
      </Box>
    </Box>
  )
}

export const displayTerminalApp = (props: TerminalAppProps) => {
  return render(<TerminalApp {...props} />)
}
