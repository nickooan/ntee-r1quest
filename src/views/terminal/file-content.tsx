import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { EditSuggestionState, SearchMatch } from "../key-helpers/index.ts"
import {
  buildMatchesByLine,
  noLineMatches,
  type LineMatch,
} from "./search-matches.ts"

export type FilePaneLayout = {
  contentWidth: number
  contentHeight: number
  lineNumberWidth: number
}

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

export type HighlightSegment = {
  text: string
  color?: React.ComponentProps<typeof Text>["color"]
  bold?: boolean
  dimColor?: boolean
}

type HighlightLanguage = "r1quest" | "graphql"

const savePromptBackgroundColor = "black"
const paddingX = 1
const maxSuggestionOverlayItems = 6
const syntaxPattern =
  /(@)(i|f|env)(\([^)]*\))|\b(true|false|null)\b|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\/\/.*$/g
// Tokens highlighted inside a macro's parentheses: the `or` default keyword and
// the immediate default value (string/number/boolean).
const macroArgsPattern =
  /\bor\b|"(?:\\.|[^"\\])*"|\b(true|false)\b|-?\d+(?:\.\d+)?/g
// A macro embedded inside a string value, e.g. "/todos/@i(id)". Only plain
// @i(key) interpolates inside strings — @env/@f and `or` defaults do not work
// there — so only that form is highlighted; anything else stays string text.
const stringMacroPattern = /(@)(i)(\([A-Za-z][A-Za-z0-9_-]*\))/g
const keywordPattern = /^(\s*)(ref|url|type|header|authorization|auth|body)\b/
const graphqlStartPattern = /^\s*(query|mutation)\s*:\s*(?:"|$)/
const graphqlSugarStartPattern = /^\s*(query|mutation)\b(?!\s*:)/
const graphqlStringStartPattern = /^\s*"/
const graphqlSyntaxPattern =
  /#.*$|"(?:\\.|[^"\\])*"|\$[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*|\b(query|mutation|subscription|fragment|on|true|false|null)\b|-?\d+(?:\.\d+)?|[!$():=@{}\[\],|]/g

const hasClosingUnescapedQuote = (
  line: string,
  startIndex: number,
): boolean => {
  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] !== '"') {
      continue
    }

    let slashCount = 0

    for (
      let slashIndex = index - 1;
      slashIndex >= 0 && line[slashIndex] === "\\";
      slashIndex -= 1
    ) {
      slashCount += 1
    }

    if (slashCount % 2 === 0) {
      return true
    }
  }

  return false
}

const getGraphqlBraceDelta = (line: string): number => {
  let delta = 0
  let insideString = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (insideString) {
      if (char === "\\" && index + 1 < line.length) {
        index += 1
      } else if (char === '"') {
        insideString = false
      }

      continue
    }

    if (char === "#") {
      break
    }

    if (char === '"') {
      insideString = true
    } else if (char === "{") {
      delta += 1
    } else if (char === "}") {
      delta -= 1
    }
  }

  return delta
}

export const buildGraphqlHighlightLines = (lines: string[]): Set<number> => {
  const graphqlLines = new Set<number>()
  let pendingGraphqlValue = false
  let insideGraphqlString = false
  let insideGraphqlSugarBlock = false
  let graphqlSugarBraceDepth = 0

  lines.forEach((line, lineIndex) => {
    if (insideGraphqlSugarBlock) {
      graphqlLines.add(lineIndex)
      graphqlSugarBraceDepth += getGraphqlBraceDelta(line)

      if (graphqlSugarBraceDepth <= 0) {
        insideGraphqlSugarBlock = false
        graphqlSugarBraceDepth = 0
      }

      return
    }

    if (insideGraphqlString) {
      graphqlLines.add(lineIndex)

      if (hasClosingUnescapedQuote(line, 0)) {
        insideGraphqlString = false
      }

      return
    }

    if (pendingGraphqlValue) {
      if (!line.trim()) {
        return
      }

      pendingGraphqlValue = false

      if (!graphqlStringStartPattern.test(line)) {
        return
      }

      graphqlLines.add(lineIndex)

      const quoteIndex = line.indexOf('"')

      if (!hasClosingUnescapedQuote(line, quoteIndex + 1)) {
        insideGraphqlString = true
      }

      return
    }

    if (graphqlSugarStartPattern.test(line)) {
      graphqlLines.add(lineIndex)
      graphqlSugarBraceDepth = getGraphqlBraceDelta(line)

      if (graphqlSugarBraceDepth > 0) {
        insideGraphqlSugarBlock = true
      } else {
        graphqlSugarBraceDepth = 0
      }

      return
    }

    const graphqlStartMatch = line.match(graphqlStartPattern)

    if (!graphqlStartMatch) {
      return
    }

    const quoteIndex = line.indexOf('"')

    if (quoteIndex === -1) {
      pendingGraphqlValue = true
      return
    }

    graphqlLines.add(lineIndex)

    if (!hasClosingUnescapedQuote(line, quoteIndex + 1)) {
      insideGraphqlString = true
    }
  })

  return graphqlLines
}

export const buildFilePaneLayout = (
  width: number,
  height: number,
  lineCount = 1,
): FilePaneLayout => {
  const contentHeight = Math.max(1, height - 2)
  const lineNumberWidth = String(Math.max(lineCount, contentHeight)).length
  const gutterWidth = lineNumberWidth + 2
  const contentWidth = Math.max(1, width - 2 - paddingX * 2 - gutterWidth)

  return {
    contentWidth,
    contentHeight,
    lineNumberWidth,
  }
}

const highlightGraphqlLine = (line: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of line.matchAll(graphqlSyntaxPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start > cursor) {
      segments.push({ text: line.slice(cursor, start) })
    }

    if (token.startsWith("#")) {
      segments.push({ text: token, dimColor: true })
    } else if (token.startsWith('"')) {
      segments.push({ text: token, color: "yellow" })
    } else if (token.startsWith("$")) {
      segments.push({ text: token, color: "green", bold: true })
    } else if (token.startsWith("@")) {
      segments.push({ text: token, color: "red", bold: true })
    } else if (match[1]) {
      segments.push({ text: token, color: "cyan", bold: true })
    } else if (/^-?\d/.test(token)) {
      segments.push({ text: token, color: "blue" })
    } else {
      segments.push({ text: token, dimColor: true })
    }

    cursor = start + token.length
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor) })
  }

  return segments
}

// Sub-highlights a macro's parenthesized arguments, e.g. (key or "default"):
// the `or` keyword and the immediate default value are coloured, while the key
// and punctuation keep the default colour, as before.
const highlightMacroArgs = (args: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of args.matchAll(macroArgsPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start > cursor) {
      segments.push({ text: args.slice(cursor, start) })
    }

    if (token === "or") {
      segments.push({ text: token, color: "cyan", bold: true })
    } else if (token.startsWith('"')) {
      segments.push({ text: token, color: "yellow" })
    } else if (match[1]) {
      segments.push({ text: token, color: "magenta" })
    } else {
      segments.push({ text: token, color: "blue" })
    }

    cursor = start + token.length
  }

  if (cursor < args.length) {
    segments.push({ text: args.slice(cursor) })
  }

  return segments
}

// Highlights a string value (including its quotes), sub-highlighting any macros
// embedded in it (e.g. a URL "/todos/@env(id or 1)") while the surrounding text
// keeps the string colour.
const highlightString = (token: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of token.matchAll(stringMacroPattern)) {
    const start = match.index ?? 0
    const [whole, at, action, args] = match

    if (at === undefined || action === undefined || args === undefined) {
      continue
    }

    if (start > cursor) {
      segments.push({ text: token.slice(cursor, start), color: "yellow" })
    }

    segments.push({ text: at, color: "red", bold: true })
    segments.push({ text: action, color: "green", bold: true })
    // No `or` defaults are valid inside strings, so the args are a plain key.
    segments.push({ text: args })

    cursor = start + whole.length
  }

  if (cursor < token.length) {
    segments.push({ text: token.slice(cursor), color: "yellow" })
  }

  return segments
}

export const highlightLine = (
  line: string,
  language: HighlightLanguage = "r1quest",
): HighlightSegment[] => {
  if (language === "graphql") {
    return highlightGraphqlLine(line)
  }

  const segments: HighlightSegment[] = []
  const keywordMatch = line.match(keywordPattern)
  const keywordStart = keywordMatch?.[1]?.length ?? -1
  const keywordEnd =
    keywordMatch && keywordMatch[2] ? keywordStart + keywordMatch[2].length : -1
  let cursor = keywordEnd === -1 ? 0 : keywordEnd

  if (keywordEnd !== -1) {
    if (keywordStart > 0) {
      segments.push({ text: line.slice(0, keywordStart) })
    }

    segments.push({
      text: line.slice(keywordStart, keywordEnd),
      color: "cyan",
      bold: true,
    })
  }

  for (const match of line.matchAll(syntaxPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start < cursor) {
      continue
    }

    if (start > cursor) {
      segments.push({ text: line.slice(cursor, start) })
    }

    if (match[1] && match[2] && match[3]) {
      segments.push({ text: match[1], color: "red", bold: true })
      segments.push({ text: match[2], color: "green", bold: true })
      segments.push(...highlightMacroArgs(match[3]))
    } else if (match[4]) {
      segments.push({ text: token, color: "magenta" })
    } else if (token.startsWith('"')) {
      segments.push(...highlightString(token))
    } else if (token.startsWith("//")) {
      segments.push({ text: token, dimColor: true })
    } else {
      segments.push({ text: token, color: "blue" })
    }

    cursor = start + token.length
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor) })
  }

  return segments
}

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
