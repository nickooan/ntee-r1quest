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
  version?: string
  requestDurationMs?: number
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
const requestStatsHeight = 1
const paneGap = 1
const commandBackgroundColor = "#1f1f1f"
const paneBorderColor = "#3a3a3a"

export type FileTreeEntry = {
  name: string
  relativePath: string
  commandValue: string
  depth: number
  type: "directory" | "request" | "file"
  isExpanded: boolean
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

export const buildFileTreeEntries = (
  root: string | undefined,
  expandedDirectoryPaths: ReadonlySet<string> = new Set(),
): FileTreeEntry[] => {
  if (!root) {
    return []
  }

  const resolvedRoot = resolve(root)
  const entries: FileTreeEntry[] = []

  const appendDirectory = (directoryPath: string, depth: number) => {
    const resolvedDirectory = resolve(resolvedRoot, directoryPath)

    if (!isInsideRoot(resolvedRoot, resolvedDirectory)) {
      return
    }

    try {
      const directoryEntries = readdirSync(resolvedDirectory, {
        withFileTypes: true,
      }).sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      })

      for (const entry of directoryEntries) {
        const relativeEntryPath = directoryPath
          ? `${directoryPath}/${entry.name}`
          : entry.name

        if (entry.isDirectory()) {
          const isExpanded = expandedDirectoryPaths.has(relativeEntryPath)

          entries.push({
            name: entry.name,
            relativePath: relativeEntryPath,
            commandValue: `${relativeEntryPath}/`,
            depth,
            type: "directory",
            isExpanded,
          })

          if (isExpanded) {
            appendDirectory(relativeEntryPath, depth + 1)
          }

          continue
        }

        if (!entry.isFile()) {
          continue
        }

        const isRequest = entry.name.endsWith(".nts")
        const commandValue = isRequest
          ? relativeEntryPath.slice(0, -".nts".length)
          : relativeEntryPath

        entries.push({
          name: entry.name,
          relativePath: relativeEntryPath,
          commandValue,
          depth,
          type: isRequest ? "request" : "file",
          isExpanded: false,
        })
      }
    } catch {
      return
    }
  }

  appendDirectory("", 0)

  return entries
}

export const findFileTreeMatchIndex = (
  entries: FileTreeEntry[],
  input: string,
): number => {
  const normalizedInput = input.trim().replaceAll("\\", "/").toLowerCase()

  if (!normalizedInput || normalizedInput.startsWith("@")) {
    return -1
  }

  const exactIndex = entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase() === normalizedInput ||
      entry.name.toLowerCase() === normalizedInput
    )
  })

  if (exactIndex !== -1) {
    return exactIndex
  }

  const startsWithIndex = entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase().startsWith(normalizedInput) ||
      entry.name.toLowerCase().startsWith(normalizedInput)
    )
  })

  if (startsWithIndex !== -1) {
    return startsWithIndex
  }

  return entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase().includes(normalizedInput) ||
      entry.name.toLowerCase().includes(normalizedInput)
    )
  })
}

export const buildFileTreeViewport = (
  entries: FileTreeEntry[],
  height: number,
  scrollY: number,
  highlightedIndex: number,
): {
  entries: FileTreeEntry[]
  maxScrollY: number
  safeScrollY: number
} => {
  const maxScrollY = Math.max(0, entries.length - height)
  const nextScrollY =
    highlightedIndex === -1
      ? scrollY
      : highlightedIndex - Math.floor(Math.max(1, height) / 2)
  const safeScrollY = clampValue(nextScrollY, 0, maxScrollY)
  const visibleEntries = entries.slice(safeScrollY, safeScrollY + height)

  return {
    entries: visibleEntries,
    maxScrollY,
    safeScrollY,
  }
}

const formatFileTreeEntryLabel = (
  entry: FileTreeEntry,
  width: number,
): string => {
  const indent = "  ".repeat(entry.depth)
  const marker =
    entry.type === "directory" ? (entry.isExpanded ? "↓ " : "→ ") : "  "
  const label = `${indent}${marker}${entry.name}`

  if (label.length > width) {
    return label.slice(0, Math.max(0, width - 1)).padEnd(width, " ")
  }

  return label.padEnd(width, " ")
}

const formatFileTreeEntryParts = (
  entry: FileTreeEntry,
  width: number,
): {
  indent: string
  marker: string
  name: string
  padding: string
} => {
  const label = formatFileTreeEntryLabel(entry, width)
  const indent = "  ".repeat(entry.depth)
  const marker =
    entry.type === "directory" ? (entry.isExpanded ? "↓ " : "→ ") : "  "
  const prefixLength = Math.min(label.length, indent.length + marker.length)

  return {
    indent: label.slice(0, Math.min(label.length, indent.length)),
    marker: label.slice(indent.length, prefixLength),
    name: label.slice(prefixLength).trimEnd(),
    padding: " ".repeat(label.length - label.trimEnd().length),
  }
}

export const buildExpandedDirectoryPaths = (
  commandValue: string,
): Set<string> => {
  const expandedDirectoryPaths = new Set<string>()
  const normalizedCommand = commandValue.trim().replaceAll("\\", "/")
  const pathParts = normalizedCommand.split("/").filter(Boolean)
  const directoryDepth = normalizedCommand.endsWith("/")
    ? pathParts.length
    : Math.max(0, pathParts.length - 1)

  for (let index = 1; index <= directoryDepth; index += 1) {
    expandedDirectoryPaths.add(pathParts.slice(0, index).join("/"))
  }

  return expandedDirectoryPaths
}

const resolveHighlightedEntry = (
  entries: FileTreeEntry[],
  input: string,
): number => {
  const matchedIndex = findFileTreeMatchIndex(entries, input)

  if (matchedIndex !== -1) {
    return matchedIndex
  }

  return -1
}

export const resolveSidebarCommand = (
  inputCommand: string,
  selectedCommand: string,
): string => {
  const trimmedInputCommand = inputCommand.trim()

  if (!trimmedInputCommand || trimmedInputCommand.startsWith("@")) {
    return selectedCommand
  }

  return inputCommand
}

type SidebarProps = {
  entries: FileTreeEntry[]
  highlightedIndex: number
  width: number
  height: number
}

type PaneTitleProps = {
  title: string
  width: number
}

const PaneTitle = ({ title, width }: PaneTitleProps) => {
  const label = ` ${title} `.slice(0, Math.max(0, width - 4))

  return (
    <Box position="absolute" top={-1} left={2}>
      <Text color="white">{label}</Text>
    </Box>
  )
}

const Sidebar = ({
  entries,
  highlightedIndex,
  width,
  height,
}: SidebarProps) => {
  const viewportHeight = Math.max(1, height - 2)
  const viewport = buildFileTreeViewport(
    entries,
    viewportHeight,
    0,
    highlightedIndex,
  )

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={paneBorderColor}
      position="relative"
    >
      <PaneTitle title="Collections" width={width} />
      {viewport.entries.map((entry, index) => {
        const entryIndex = viewport.safeScrollY + index
        const isHighlighted = entryIndex === highlightedIndex
        const labelParts = formatFileTreeEntryParts(
          entry,
          Math.max(1, width - 2),
        )
        const textColor = isHighlighted ? "black" : undefined
        const backgroundColor = isHighlighted ? "yellow" : undefined
        const dimColor = !isHighlighted

        return (
          <Text
            key={entry.relativePath}
            color={textColor}
            backgroundColor={backgroundColor}
            dimColor={dimColor}
          >
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
            >
              {labelParts.indent}
            </Text>
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
              bold={entry.type === "directory"}
            >
              {labelParts.marker}
            </Text>
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
            >
              {labelParts.name}
              {labelParts.padding}
            </Text>
          </Text>
        )
      })}
      {Array.from({
        length: Math.max(0, viewportHeight - viewport.entries.length),
      }).map((_, index) => (
        <Text key={`empty-tree-${index}`}>
          {" ".repeat(Math.max(1, width - 2))}
        </Text>
      ))}
    </Box>
  )
}

type ResponsePaneProps = {
  contentLines: string[]
  viewport: Viewport
  searchMatches: SearchMatch[]
  focusedMatchIndex: number
  width: number
  height: number
}

const ResponsePane = ({
  contentLines,
  viewport,
  searchMatches,
  focusedMatchIndex,
  width,
  height,
}: ResponsePaneProps) => {
  const contentWidth = Math.max(1, width - 2)

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={paneBorderColor}
      position="relative"
    >
      <PaneTitle title="Result" width={width} />
      {viewport.lines.map((line, index) => (
        <Box key={`${viewport.safeScrollY}-${index}`} width={contentWidth}>
          <VisibleLine
            line={contentLines[viewport.safeScrollY + index] ?? ""}
            lineIndex={viewport.safeScrollY + index}
            scrollX={viewport.safeScrollX}
            width={contentWidth}
            matches={searchMatches}
            focusedMatchIndex={focusedMatchIndex}
          />
        </Box>
      ))}
    </Box>
  )
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
    const isFocusedMatch = match.matchIndex === focusedMatchIndex

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
        backgroundColor={isFocusedMatch ? "yellow" : "white"}
        bold={isFocusedMatch}
        underline={isFocusedMatch}
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
  version,
  requestDurationMs,
  height: fixedHeight,
  width: fixedWidth,
  onCommand,
}: TerminalAppProps) => {
  const { columns, rows } = useWindowSize()
  const [frameIndex, setFrameIndex] = useState(0)
  const [isCursorVisible, setIsCursorVisible] = useState(true)
  const [mode, setMode] = useState(TerminalMode.Query)
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
  const [selectedCommand, setSelectedCommand] = useState("")
  const height = fixedHeight ?? rows ?? defaultHeight
  const width = fixedWidth ?? columns ?? defaultWidth
  const sidebarCommand = resolveSidebarCommand(
    baseModeState.command,
    selectedCommand,
  )
  const expandedPathsForInput = buildExpandedDirectoryPaths(sidebarCommand)
  const fileTreeEntries = buildFileTreeEntries(root, expandedPathsForInput)
  const sidebarWidth = Math.min(
    Math.max(12, Math.floor(width / 4)),
    Math.max(1, width - paneGap - 3),
  )
  const responsePaneWidth = Math.max(3, width - sidebarWidth - paneGap)
  const responseContentWidth = Math.max(1, responsePaneWidth - 2)
  const viewHeight = Math.max(
    1,
    height - headerHeight - requestStatsHeight - commandLineHeight,
  )
  const responseContentHeight = Math.max(1, viewHeight - 2)
  const highlightedEntryIndex = resolveHighlightedEntry(
    fileTreeEntries,
    sidebarCommand,
  )
  const content = formatTerminalContent({
    response,
    error,
    isPending,
    frameIndex,
  })
  const viewport = buildTerminalViewport(
    content,
    responseContentWidth,
    responseContentHeight,
    mode === TerminalMode.Search
      ? searchModeState.scrollX
      : baseModeState.scrollX,
    mode === TerminalMode.Search
      ? searchModeState.scrollY
      : baseModeState.scrollY,
  )
  const searchMatches =
    mode === TerminalMode.Search
      ? findSearchMatches(content, searchModeState.query)
      : []
  const contentLines = normalizeLines(content)
  const inputValue =
    mode === TerminalMode.Search ? searchModeState.input : baseModeState.command
  const promptValue = `@${mode} >`

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

  useEffect(() => {
    const interval = setInterval(() => {
      setIsCursorVisible((currentValue) => !currentValue)
    }, 500)

    return () => {
      clearInterval(interval)
    }
  }, [])

  useInput((input, key) => {
    if (mode === TerminalMode.Search) {
      const limits = {
        maxScrollX: viewport.maxScrollX,
        maxScrollY: viewport.maxScrollY,
        viewWidth: responseContentWidth,
        viewHeight: responseContentHeight,
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

      if (nextMode === TerminalMode.Query) {
        setMode(TerminalMode.Query)
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

    const isModeCommandInput = baseModeState.command.trim().startsWith("@")
    const isQueryCommandInput =
      baseModeState.command.trim() !== "" && !isModeCommandInput
    const highlightedEntry = isQueryCommandInput
      ? fileTreeEntries[highlightedEntryIndex]
      : undefined

    if (!isModeCommandInput && highlightedEntry && key.return) {
      if (highlightedEntry.type === "directory") {
        setSelectedCommand(highlightedEntry.commandValue)
        setBaseModeState({
          ...baseModeState,
          command: highlightedEntry.commandValue,
        })
        return
      }

      if (highlightedEntry.type === "request") {
        setSelectedCommand(highlightedEntry.commandValue)
        setBaseModeState({
          ...baseModeState,
          command: "",
        })
        onCommand?.(highlightedEntry.commandValue)
        return
      }

      setSelectedCommand(highlightedEntry.commandValue)
      setBaseModeState({
        ...baseModeState,
        command: highlightedEntry.commandValue,
      })
      return
    }

    const result = handleBaseModeInput(input, key, baseModeState, {
      maxScrollX: viewport.maxScrollX,
      maxScrollY: viewport.maxScrollY,
      viewHeight: responseContentHeight,
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

    if (result.command !== undefined && nextMode === null) {
      if (result.command.trim()) {
        setSelectedCommand(result.command)
      }
      onCommand?.(result.command)
    }
  })

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexDirection="column" width={width} height={headerHeight}>
        <Text bold>{">_ Ntee R1quest"}</Text>
        {version && <Text color="#006400">{`ver: ${version}`}</Text>}
      </Box>
      <Box width={width} height={requestStatsHeight}>
        <Text>{`◷ Time Spend ${requestDurationMs ?? 0} ms,`}</Text>
      </Box>
      <Box width={width} height={viewHeight} columnGap={paneGap}>
        <Sidebar
          entries={fileTreeEntries}
          highlightedIndex={highlightedEntryIndex}
          width={sidebarWidth}
          height={viewHeight}
        />
        <ResponsePane
          contentLines={contentLines}
          viewport={viewport}
          searchMatches={searchMatches}
          focusedMatchIndex={searchModeState.focusedMatchIndex}
          width={responsePaneWidth}
          height={viewHeight}
        />
      </Box>
      <Box
        width={width}
        height={commandLineHeight}
        backgroundColor={commandBackgroundColor}
      >
        <Text backgroundColor={commandBackgroundColor}>{promptValue}</Text>
        <Text backgroundColor={commandBackgroundColor}>{inputValue}</Text>
        <Text bold backgroundColor={commandBackgroundColor}>
          {isCursorVisible ? "_" : " "}
        </Text>
      </Box>
    </Box>
  )
}

export const displayTerminalApp = (props: TerminalAppProps) => {
  return render(<TerminalApp {...props} />)
}
