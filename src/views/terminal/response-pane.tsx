import React from "react"
import { Box, Text } from "ink"
import type { SearchMatch } from "../key-helpers/index.ts"
import { paneBorderColor } from "./constants.ts"
import { FileContent, type FileContentProps } from "./file-content.tsx"
import { PaneTitle } from "./pane-title.tsx"
import type { Viewport } from "./viewport.ts"

type ResponsePaneProps = {
  title: string
  contentLines: string[]
  viewport: Viewport
  searchMatches: SearchMatch[]
  focusedMatchIndex: number
  width: number
  height: number
  fileContent?: Omit<
    FileContentProps,
    "width" | "height" | "searchMatches" | "focusedMatchIndex"
  >
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

export const ResponsePane = ({
  title,
  contentLines,
  viewport,
  searchMatches,
  focusedMatchIndex,
  width,
  height,
  fileContent,
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
      <PaneTitle title={title} width={width} />
      {fileContent ? (
        <FileContent
          {...fileContent}
          width={width}
          height={height}
          searchMatches={searchMatches}
          focusedMatchIndex={focusedMatchIndex}
        />
      ) : (
        viewport.lines.map((line, index) => (
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
        ))
      )}
    </Box>
  )
}
