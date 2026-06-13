import React, { memo, useMemo } from "react"
import { Box, Text } from "ink"
import type { SearchMatch } from "../key-helpers/index.ts"
import { paneBorderColor } from "./constants.ts"
import { FileContent, type FileContentProps } from "./file-content.tsx"
import { PaneTitle } from "./pane-title.tsx"
import {
  buildMatchesByLine,
  noLineMatches,
  type LineMatch,
} from "./search-matches.ts"
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
  scrollX: number
  width: number
  lineMatches: LineMatch[]
  focusedMatchIndex: number
}

const VisibleLine = ({
  line,
  scrollX,
  width,
  lineMatches,
  focusedMatchIndex,
}: VisibleLineProps) => {
  const visibleStart = scrollX
  const visibleEnd = scrollX + width
  const children: React.ReactNode[] = []
  let cursor = visibleStart

  for (const match of lineMatches) {
    if (match.end <= visibleStart || match.start >= visibleEnd) {
      continue
    }

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

export const ResponsePane = memo(function ResponsePane({
  title,
  contentLines,
  viewport,
  searchMatches,
  focusedMatchIndex,
  width,
  height,
  fileContent,
}: ResponsePaneProps) {
  const contentWidth = Math.max(1, width - 2)
  const matchesByLine = useMemo(
    () => buildMatchesByLine(searchMatches),
    [searchMatches],
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
        viewport.lines.map((line, index) => {
          const lineIndex = viewport.safeScrollY + index

          return (
            <Box key={`${viewport.safeScrollY}-${index}`} width={contentWidth}>
              <VisibleLine
                line={contentLines[lineIndex] ?? ""}
                scrollX={viewport.safeScrollX}
                width={contentWidth}
                lineMatches={matchesByLine.get(lineIndex) ?? noLineMatches}
                focusedMatchIndex={focusedMatchIndex}
              />
            </Box>
          )
        })
      )}
    </Box>
  )
})
