import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { EditSuggestionState, SearchMatch } from "../key-helpers/index.ts"
import {
  buildMatchesByLine,
  noLineMatches,
  type LineMatch,
} from "./search-matches.ts"
import {
  buildFilePaneLayout,
  buildGraphqlHighlightLines,
  highlightLine,
  paddingX,
  type HighlightLanguage,
} from "./file-content-highlight.ts"

export type FileContentProps = {
  fileName: string
  content: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  searchMatches: SearchMatch[]
  focusedMatchIndex: number
  isEditing?: boolean
  cursorX?: number
  cursorY?: number
  input?: string
  suggestions?: EditSuggestionState | null
  isSavePromptOpen?: boolean
  selectedSaveAction?: "yes" | "no"
}

const savePromptBackgroundColor = "black"
const maxSuggestionOverlayItems = 6

const HighlightedText = ({
  text,
  keyPrefix,
  language = "r1quest",
}: {
  text: string
  keyPrefix: string
  language?: HighlightLanguage
}) => {
  return (
    <>
      {highlightLine(text, language).map((segment, index) => (
        <Text
          key={`${keyPrefix}-${index}`}
          color={segment.color}
          bold={segment.bold}
          dimColor={segment.dimColor}
        >
          {segment.text}
        </Text>
      ))}
    </>
  )
}

const HighlightedLine = ({
  line,
  lineIndex,
  width,
  scrollX,
  lineMatches,
  focusedMatchIndex,
  language = "r1quest",
}: {
  line: string
  lineIndex: number
  width: number
  scrollX: number
  lineMatches: LineMatch[]
  focusedMatchIndex: number
  language?: HighlightLanguage
}) => {
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
        <HighlightedText
          key={`text-${cursor}`}
          keyPrefix={`text-${lineIndex}-${cursor}`}
          text={line.slice(cursor, matchStart)}
          language={language}
        />,
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
    const trailingText = line.slice(cursor, visibleEnd)

    children.push(
      <HighlightedText
        key={`text-${cursor}`}
        keyPrefix={`text-${lineIndex}-${cursor}`}
        text={trailingText}
        language={language}
      />,
    )
    children.push(
      <Text key={`padding-${cursor}`}>
        {" ".repeat(Math.max(0, visibleEnd - cursor - trailingText.length))}
      </Text>,
    )
  }

  return <>{children}</>
}

const EditableLine = ({
  line,
  width,
  scrollX,
  cursorX,
  input,
  language = "r1quest",
}: {
  line: string
  width: number
  scrollX: number
  cursorX: number
  input: string
  language?: HighlightLanguage
}) => {
  const cursorEnd = cursorX + Math.max(1, input.length)
  const visibleStart = scrollX
  const visibleEnd = scrollX + width

  if (cursorEnd <= visibleStart || cursorX >= visibleEnd) {
    return (
      <HighlightedLine
        line={line}
        lineIndex={0}
        width={width}
        scrollX={scrollX}
        lineMatches={noLineMatches}
        focusedMatchIndex={0}
        language={language}
      />
    )
  }

  const before = line.slice(visibleStart, cursorX)
  const cursorText = input || line[cursorX] || " "
  const visibleCursorText = cursorText.slice(
    Math.max(0, visibleStart - cursorX),
    Math.max(0, visibleEnd - cursorX),
  )
  const afterStart = input ? cursorX : cursorX + 1
  const afterVisibleStart = Math.max(afterStart, visibleStart)
  const remainingWidth = Math.max(
    0,
    width - before.length - visibleCursorText.length,
  )
  const after = line.slice(
    afterVisibleStart,
    afterVisibleStart + remainingWidth,
  )
  const renderedLength = before.length + visibleCursorText.length + after.length

  return (
    <>
      <HighlightedText keyPrefix="before" text={before} language={language} />
      <Text color="whiteBright" backgroundColor={input ? "green" : "white"}>
        {visibleCursorText}
      </Text>
      <HighlightedText keyPrefix="after" text={after} language={language} />
      {" ".repeat(Math.max(0, width - renderedLength))}
    </>
  )
}

export const FileContent = ({
  fileName,
  content,
  width,
  height,
  scrollX,
  scrollY,
  searchMatches,
  focusedMatchIndex,
  isEditing = false,
  cursorX = 0,
  cursorY = 0,
  input = "",
  isSavePromptOpen = false,
  selectedSaveAction = "yes",
  suggestions = null,
}: FileContentProps) => {
  const contentLines = useMemo(() => content.split("\n"), [content])
  const graphqlHighlightLines = useMemo(
    () => buildGraphqlHighlightLines(contentLines),
    [contentLines],
  )
  const matchesByLine = useMemo(
    () => buildMatchesByLine(searchMatches),
    [searchMatches],
  )
  const { contentWidth, contentHeight, lineNumberWidth } = buildFilePaneLayout(
    width,
    height,
    contentLines.length,
  )
  const lines = contentLines.slice(scrollY, scrollY + contentHeight)

  while (lines.length < contentHeight) {
    lines.push("")
  }

  return (
    <Box
      flexDirection="column"
      width={Math.max(1, width - 2)}
      height={height - 2}
    >
      {lines.map((line, index) => {
        const lineIndex = scrollY + index
        const language: HighlightLanguage = graphqlHighlightLines.has(lineIndex)
          ? "graphql"
          : "r1quest"

        return (
          <Text key={`${fileName}-${lineIndex}`}>
            {" ".repeat(paddingX)}
            <Text dimColor>
              {String(lineIndex + 1).padStart(lineNumberWidth, " ")}
              {" │"}
            </Text>
            {isEditing && lineIndex === cursorY ? (
              <EditableLine
                line={line}
                width={contentWidth}
                scrollX={scrollX}
                cursorX={cursorX}
                input={input}
                language={language}
              />
            ) : (
              <HighlightedLine
                line={line}
                lineIndex={lineIndex}
                width={contentWidth}
                scrollX={scrollX}
                lineMatches={matchesByLine.get(lineIndex) ?? noLineMatches}
                focusedMatchIndex={focusedMatchIndex}
                language={language}
              />
            )}
            {" ".repeat(paddingX)}
          </Text>
        )
      })}
      {isSavePromptOpen && (
        <Box
          position="absolute"
          top={Math.max(0, Math.floor(height / 2) - 3)}
          left={Math.max(1, Math.floor(width / 2) - 11)}
          width={20}
          height={5}
          borderStyle="single"
          borderColor="#5a5a5a"
          backgroundColor={savePromptBackgroundColor}
          flexDirection="column"
          alignItems="center"
        >
          <Text backgroundColor={savePromptBackgroundColor}>{"Save it?"}</Text>
          <Text backgroundColor={savePromptBackgroundColor}>
            <Text
              color={selectedSaveAction === "yes" ? "black" : undefined}
              backgroundColor={
                selectedSaveAction === "yes"
                  ? "white"
                  : savePromptBackgroundColor
              }
            >
              {" Yes "}
            </Text>
            {"  "}
            <Text
              color={selectedSaveAction === "no" ? "black" : undefined}
              backgroundColor={
                selectedSaveAction === "no"
                  ? "white"
                  : savePromptBackgroundColor
              }
            >
              {" No "}
            </Text>
          </Text>
        </Box>
      )}
      {isEditing && suggestions && suggestions.options.length > 0 && (
        <SuggestionOverlay
          suggestions={suggestions}
          width={width}
          height={height}
          contentHeight={contentHeight}
          lineNumberWidth={lineNumberWidth}
          cursorX={cursorX + input.length}
          cursorY={cursorY}
          scrollX={scrollX}
          scrollY={scrollY}
        />
      )}
    </Box>
  )
}

const SuggestionOverlay = ({
  suggestions,
  width,
  height,
  contentHeight,
  lineNumberWidth,
  cursorX,
  cursorY,
  scrollX,
  scrollY,
}: {
  suggestions: EditSuggestionState
  width: number
  height: number
  contentHeight: number
  lineNumberWidth: number
  cursorX: number
  cursorY: number
  scrollX: number
  scrollY: number
}) => {
  const optionWidth = Math.max(
    1,
    ...suggestions.options.map((option) => option.label.length),
  )
  const overlayWidth = Math.min(Math.max(4, optionWidth + 2), width - 2)
  const visibleOptionCount = Math.min(
    suggestions.options.length,
    maxSuggestionOverlayItems,
    Math.max(1, height - 2),
  )
  const overlayHeight = visibleOptionCount
  const relativeCursorY = cursorY - scrollY
  const preferredTop = relativeCursorY + 1
  const top =
    preferredTop + overlayHeight <= contentHeight
      ? preferredTop
      : Math.max(0, relativeCursorY - overlayHeight)
  const contentLeft = paddingX + lineNumberWidth + 2
  const preferredLeft = contentLeft + Math.max(0, cursorX - scrollX)
  const left = Math.min(
    Math.max(0, preferredLeft),
    Math.max(0, width - 2 - overlayWidth),
  )
  const optionStartIndex = Math.min(
    Math.max(0, suggestions.selectedIndex - visibleOptionCount + 1),
    Math.max(0, suggestions.options.length - visibleOptionCount),
  )
  const visibleOptions = suggestions.options.slice(
    optionStartIndex,
    optionStartIndex + visibleOptionCount,
  )

  return (
    <Box
      position="absolute"
      top={top}
      left={left}
      width={overlayWidth}
      height={visibleOptions.length}
      flexDirection="column"
    >
      {visibleOptions.map((option, index) => (
        <Text
          key={`${option.kind}-${option.label}`}
          color={
            optionStartIndex + index === suggestions.selectedIndex
              ? "white"
              : "black"
          }
          backgroundColor={
            optionStartIndex + index === suggestions.selectedIndex
              ? "#006400"
              : "white"
          }
        >
          {option.label.padEnd(overlayWidth, " ")}
        </Text>
      ))}
    </Box>
  )
}
