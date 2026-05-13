import type { AxiosResponse } from "axios"
import React, { useEffect, useState } from "react"
import { Box, Text, render, useInput, useWindowSize } from "ink"
import { formatError, formatPending, formatResponse } from "./response.tsx"

export type TerminalAppProps = {
  response?: AxiosResponse
  error?: unknown
  isPending?: boolean
  height?: number
  width?: number
  prompt?: string
  onCommand?: (command: string) => void | Promise<void>
}

type Viewport = {
  lines: string[]
  maxScrollX: number
  maxScrollY: number
}

const defaultHeight = 20
const defaultWidth = 80
const commandLineHeight = 1
const headerHeight = 3
const commandBackgroundColor = "#1f1f1f"

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

const normalizeLines = (content: string): string[] => {
  return content.split("\n")
}

const sliceLine = (line: string, scrollX: number, width: number): string => {
  return line.slice(scrollX, scrollX + width).padEnd(width, " ")
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

export const TerminalApp = ({
  response,
  error,
  isPending = false,
  height: fixedHeight,
  width: fixedWidth,
  prompt = ":",
  onCommand,
}: TerminalAppProps) => {
  const { columns, rows } = useWindowSize()
  const [frameIndex, setFrameIndex] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  const [command, setCommand] = useState("")
  const height = fixedHeight ?? rows ?? defaultHeight
  const width = fixedWidth ?? columns ?? defaultWidth
  const viewHeight = Math.max(1, height - headerHeight - commandLineHeight)
  const viewWidth = Math.max(1, width)
  const content = formatTerminalContent({
    response,
    error,
    isPending,
    frameIndex,
  })
  const viewport = buildTerminalViewport(content, viewWidth, viewHeight, scrollX, scrollY)
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
      <Box width={width} height={headerHeight} paddingY={1}>
        <Text bold>{">_ Ntee R1quest"}</Text>
      </Box>
      <Box flexDirection="column" width={width} height={viewHeight}>
        {viewport.lines.map((line, index) => (
          <Box key={`${safeScrollY}-${index}`} width={width}>
            <Text wrap="truncate-end">{line}</Text>
          </Box>
        ))}
      </Box>
      <Box
        width={width}
        height={commandLineHeight}
        backgroundColor={commandBackgroundColor}
      >
        <Text backgroundColor={commandBackgroundColor}>{prompt}</Text>
        <Text backgroundColor={commandBackgroundColor}>{command}</Text>
        <Text inverse backgroundColor={commandBackgroundColor}>
          {" "}
        </Text>
      </Box>
    </Box>
  )
}

export const displayTerminalApp = (props: TerminalAppProps) => {
  return render(<TerminalApp {...props} />)
}
