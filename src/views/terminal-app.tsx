import { readdirSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import type { AxiosResponse } from "axios"
import React, { useEffect, useState } from "react"
import { Box, Text, render, useInput, useWindowSize } from "ink"
import {
  clampValue,
  findSearchMatches,
  focusSearchMatch,
  handleBaseModeInput,
  handleSearchModeInput,
  resolveModeCommand,
  type BaseModeState,
  type SearchMatch,
  type SearchModeState,
  TerminalMode,
} from "./key-helpers/index.ts"
import { formatError, formatPending, formatResponse } from "./response.tsx"

export type TerminalAppProps = {
  response?: AxiosResponse
  error?: unknown
  isPending?: boolean
  root?: string
  height?: number
  width?: number
  onCommand?: (command: string) => void | Promise<void>
}

type Viewport = {
  lines: string[]
  maxScrollX: number
  maxScrollY: number
  safeScrollX: number
  safeScrollY: number
}

const defaultHeight = 20
const defaultWidth = 80
const commandLineHeight = 1
const headerHeight = 3
const suggestionHeight = 5
const commandBackgroundColor = "#1f1f1f"

export type RequestSuggestion = {
  value: string
  label: string
  type: "directory" | "request"
}

const normalizeLines = (content: string): string[] => {
  return content.split("\n")
}

const sliceLine = (line: string, scrollX: number, width: number): string => {
  return line.slice(scrollX, scrollX + width).padEnd(width, " ")
}

const isInsideRoot = (root: string, target: string): boolean => {
  const relativeTarget = relative(root, target)

  return (
    relativeTarget === "" ||
    (!relativeTarget.startsWith("..") && !relativeTarget.startsWith(sep))
  )
}

export const buildRequestSuggestions = (
  root: string | undefined,
  input: string,
): RequestSuggestion[] => {
  const trimmedInput = input.trim()

  if (!root || !trimmedInput || trimmedInput.startsWith("@")) {
    return []
  }

  const normalizedInput = trimmedInput.replaceAll("\\", "/")
  const lastSlashIndex = normalizedInput.lastIndexOf("/")
  const directoryInput =
    lastSlashIndex === -1 ? "" : normalizedInput.slice(0, lastSlashIndex)
  const namePrefix =
    lastSlashIndex === -1
      ? normalizedInput
      : normalizedInput.slice(lastSlashIndex + 1)
  const resolvedRoot = resolve(root)
  const resolvedDirectory = resolve(resolvedRoot, directoryInput)

  if (!isInsideRoot(resolvedRoot, resolvedDirectory)) {
    return []
  }

  try {
    return readdirSync(resolvedDirectory, { withFileTypes: true })
      .flatMap((entry): RequestSuggestion[] => {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(namePrefix)) {
            return []
          }

          const value = directoryInput
            ? `${directoryInput}/${entry.name}/`
            : `${entry.name}/`

          return [
            {
              value,
              label: value,
              type: "directory",
            },
          ]
        }

        if (!entry.isFile() || !entry.name.endsWith(".nts")) {
          return []
        }

        const requestName = entry.name.slice(0, -".nts".length)

        if (!requestName.startsWith(namePrefix)) {
          return []
        }

        const value = directoryInput
          ? `${directoryInput}/${requestName}`
          : requestName

        return [
          {
            value,
            label: value,
            type: "request",
          },
        ]
      })
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1
        }

        return left.label.localeCompare(right.label)
      })
  } catch {
    return []
  }
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
    safeScrollX,
    safeScrollY,
  }
}

type VisibleLineProps = {
  line: string
  lineIndex: number
  scrollX: number
  width: number
  matches: SearchMatch[]
  focusedMatchIndex: number
}

const VisibleLine = ({
  line,
  lineIndex,
  scrollX,
  width,
  matches,
  focusedMatchIndex,
}: VisibleLineProps) => {
  const visibleStart = scrollX
  const visibleEnd = scrollX + width
  const lineMatches = matches
    .map((match, matchIndex) => ({
      ...match,
      matchIndex,
    }))
    .filter(
      (match) =>
        match.lineIndex === lineIndex &&
        match.end > visibleStart &&
        match.start < visibleEnd,
    )
    .sort((left, right) => left.start - right.start)
  const children: React.ReactNode[] = []
  let cursor = visibleStart

  for (const match of lineMatches) {
    const matchStart = Math.max(match.start, visibleStart)
    const matchEnd = Math.min(match.end, visibleEnd)

    if (matchStart > cursor) {
      children.push(
        <Text key={`text-${cursor}`} wrap="truncate-end">
          {line.slice(cursor, matchStart)}
        </Text>,
      )
    }

    children.push(
      <Text
        key={`match-${match.matchIndex}-${matchStart}`}
        color="black"
        backgroundColor="white"
        bold={match.matchIndex === focusedMatchIndex}
      >
        {line.slice(matchStart, matchEnd)}
      </Text>,
    )

    cursor = matchEnd
  }

  if (cursor < visibleEnd) {
    children.push(
      <Text key={`text-${cursor}`} wrap="truncate-end">
        {line.slice(cursor, visibleEnd).padEnd(visibleEnd - cursor, " ")}
      </Text>,
    )
  }

  return <>{children}</>
}

export const TerminalApp = ({
  response,
  error,
  isPending = false,
  root,
  height: fixedHeight,
  width: fixedWidth,
  onCommand,
}: TerminalAppProps) => {
  const { columns, rows } = useWindowSize()
  const [frameIndex, setFrameIndex] = useState(0)
  const [mode, setMode] = useState(TerminalMode.Default)
  const [baseModeState, setBaseModeState] = useState<BaseModeState>({
    scrollX: 0,
    scrollY: 0,
    command: "",
  })
  const [searchModeState, setSearchModeState] = useState<SearchModeState>({
    scrollX: 0,
    scrollY: 0,
    input: "",
    query: "",
    focusedMatchIndex: 0,
  })
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const height = fixedHeight ?? rows ?? defaultHeight
  const width = fixedWidth ?? columns ?? defaultWidth
  const suggestions = buildRequestSuggestions(root, baseModeState.command)
  const shouldShowSuggestions =
    mode === TerminalMode.Default && suggestions.length > 0
  const effectiveSuggestionHeight = shouldShowSuggestions ? suggestionHeight : 0
  const viewHeight = Math.max(
    1,
    height - headerHeight - commandLineHeight - effectiveSuggestionHeight,
  )
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
    mode === TerminalMode.Search ? searchModeState.scrollX : baseModeState.scrollX,
    mode === TerminalMode.Search ? searchModeState.scrollY : baseModeState.scrollY,
  )
  const searchMatches =
    mode === TerminalMode.Search ? findSearchMatches(content, searchModeState.query) : []
  const contentLines = normalizeLines(content)
  const inputValue =
    mode === TerminalMode.Search ? searchModeState.input : baseModeState.command
  const promptValue = `@${mode}:`
  const safeSelectedSuggestionIndex = clampValue(
    selectedSuggestionIndex,
    0,
    Math.max(0, suggestions.length - 1),
  )
  const suggestionWindowStart = clampValue(
    safeSelectedSuggestionIndex - suggestionHeight + 1,
    0,
    Math.max(0, suggestions.length - suggestionHeight),
  )
  const visibleSuggestions = suggestions.slice(
    suggestionWindowStart,
    suggestionWindowStart + suggestionHeight,
  )

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
    if (mode === TerminalMode.Search) {
      const limits = {
        maxScrollX: viewport.maxScrollX,
        maxScrollY: viewport.maxScrollY,
        viewHeight,
      }
      const result = handleSearchModeInput(
        input,
        key,
        searchModeState,
        limits,
        searchMatches,
      )
      const nextMode =
        result.submittedQuery === undefined
          ? null
          : resolveModeCommand(result.submittedQuery)

      if (nextMode === TerminalMode.Default) {
        setMode(TerminalMode.Default)
        setBaseModeState({
          ...baseModeState,
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
        })
        setSearchModeState({
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        return
      }

      const nextMatches = findSearchMatches(content, result.state.query)
      const nextState =
        result.submittedQuery === undefined
          ? result.state
          : focusSearchMatch(result.state, limits, nextMatches, 0)

      setSearchModeState(nextState)
      return
    }

    if (shouldShowSuggestions && key.upArrow) {
      setSelectedSuggestionIndex((currentIndex) =>
        clampValue(currentIndex - 1, 0, suggestions.length - 1),
      )
      return
    }

    if (shouldShowSuggestions && key.downArrow) {
      setSelectedSuggestionIndex((currentIndex) =>
        clampValue(currentIndex + 1, 0, suggestions.length - 1),
      )
      return
    }

    if (shouldShowSuggestions && key.return) {
      const selectedSuggestion = suggestions[safeSelectedSuggestionIndex]

      if (selectedSuggestion?.type === "directory") {
        setBaseModeState({
          ...baseModeState,
          command: selectedSuggestion.value,
        })
        setSelectedSuggestionIndex(0)
        return
      }

      if (selectedSuggestion) {
        setBaseModeState({
          ...baseModeState,
          command: "",
        })
        setSelectedSuggestionIndex(0)
        onCommand?.(selectedSuggestion.value)
        return
      }
    }

    const result = handleBaseModeInput(input, key, baseModeState, {
      maxScrollX: viewport.maxScrollX,
      maxScrollY: viewport.maxScrollY,
      viewHeight,
    })
    const nextMode =
      result.command === undefined ? null : resolveModeCommand(result.command)

    if (nextMode === TerminalMode.Search) {
      setMode(TerminalMode.Search)
      setSearchModeState({
        scrollX: result.state.scrollX,
        scrollY: result.state.scrollY,
        input: "",
        query: "",
        focusedMatchIndex: 0,
      })
      setBaseModeState(result.state)
      return
    }

    setBaseModeState(result.state)

    if (result.state.command !== baseModeState.command) {
      setSelectedSuggestionIndex(0)
    }

    if (result.command !== undefined && nextMode === null) {
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
          <Box key={`${viewport.safeScrollY}-${index}`} width={width}>
            <VisibleLine
              line={contentLines[viewport.safeScrollY + index] ?? ""}
              lineIndex={viewport.safeScrollY + index}
              scrollX={viewport.safeScrollX}
              width={viewWidth}
              matches={searchMatches}
              focusedMatchIndex={searchModeState.focusedMatchIndex}
            />
          </Box>
        ))}
      </Box>
      {shouldShowSuggestions && (
        <Box flexDirection="column" width={width} height={suggestionHeight}>
          {visibleSuggestions.map((suggestion, index) => {
            const suggestionIndex = suggestionWindowStart + index
            const isSelected = suggestionIndex === safeSelectedSuggestionIndex

            return (
              <Box key={suggestion.value} width={width}>
                <Text
                  color={isSelected ? "black" : undefined}
                  backgroundColor={isSelected ? "white" : commandBackgroundColor}
                  bold={suggestion.type === "directory"}
                >
                  {suggestion.label.padEnd(width, " ")}
                </Text>
              </Box>
            )
          })}
          {Array.from({
            length: suggestionHeight - visibleSuggestions.length,
          }).map((_, index) => (
            <Text key={`empty-suggestion-${index}`} backgroundColor={commandBackgroundColor}>
              {" ".repeat(width)}
            </Text>
          ))}
        </Box>
      )}
      <Box
        width={width}
        height={commandLineHeight}
        backgroundColor={commandBackgroundColor}
      >
        <Text backgroundColor={commandBackgroundColor}>{promptValue}</Text>
        <Text backgroundColor={commandBackgroundColor}>{inputValue}</Text>
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
