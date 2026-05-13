import type { AxiosResponse } from "axios"
import React, { useEffect, useState } from "react"
import { Box, Text, render, useInput, useWindowSize } from "ink"
import {
  clampValue,
  handleBaseModeInput,
  type BaseModeState,
} from "./key-helpers/index.ts"
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
  const safeScrollX = clampValue(scrollX, 0, maxScrollX)
  const safeScrollY = clampValue(scrollY, 0, maxScrollY)
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
  const [baseModeState, setBaseModeState] = useState<BaseModeState>({
    scrollX: 0,
    scrollY: 0,
    command: "",
  })
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
  const viewport = buildTerminalViewport(
    content,
    viewWidth,
    viewHeight,
    baseModeState.scrollX,
    baseModeState.scrollY,
  )
  const safeScrollY = clampValue(baseModeState.scrollY, 0, viewport.maxScrollY)

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
    const result = handleBaseModeInput(input, key, baseModeState, {
      maxScrollX: viewport.maxScrollX,
      maxScrollY: viewport.maxScrollY,
      viewHeight,
    })

    setBaseModeState(result.state)

    if (result.command !== undefined) {
      onCommand?.(result.command)
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
        <Text backgroundColor={commandBackgroundColor}>{baseModeState.command}</Text>
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
