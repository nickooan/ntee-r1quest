import React from "react"
import { Box, Text } from "ink"

export type ViewEditProps = {
  fileName: string
  content: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  isEditing?: boolean
  cursorX?: number
  cursorY?: number
  input?: string
  isSavePromptOpen?: boolean
  selectedSaveAction?: "yes" | "no"
}

const borderColor = "#5a5a5a"
const paddingX = 1
const paddingY = 1
const syntaxPattern =
  /(@)(i|f|env)(\([^)]*\))|\b(true|false|null)\b|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\/\/.*$/g
const keywordPattern = /^(\s*)(ref|url|type|header|authorization|auth|body)\b/

type HighlightSegment = {
  text: string
  color?: React.ComponentProps<typeof Text>["color"]
  bold?: boolean
  dimColor?: boolean
}

const highlightLine = (line: string): HighlightSegment[] => {
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
      segments.push({ text: match[3] })
    } else if (match[4]) {
      segments.push({ text: token, color: "magenta" })
    } else if (token.startsWith('"')) {
      segments.push({ text: token, color: "yellow" })
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

type HighlightedLineProps = {
  line: string
  width: number
  scrollX: number
}

const HighlightedText = ({ text }: { text: string }) => {
  return (
    <>
      {highlightLine(text).map((segment, index) => (
        <Text
          key={`${index}-${segment.text}`}
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

const HighlightedLine = ({ line, width, scrollX }: HighlightedLineProps) => {
  const visibleLine = line.slice(scrollX, scrollX + width)
  const padding = Math.max(0, width - visibleLine.length)

  return (
    <>
      <HighlightedText text={visibleLine} />
      {" ".repeat(padding)}
    </>
  )
}

type EditableLineProps = {
  line: string
  width: number
  scrollX: number
  cursorX: number
  input: string
}

const EditableLine = ({
  line,
  width,
  scrollX,
  cursorX,
  input,
}: EditableLineProps) => {
  const cursorEnd = cursorX + Math.max(1, input.length)
  const visibleStart = scrollX
  const visibleEnd = scrollX + width

  if (cursorEnd <= visibleStart || cursorX >= visibleEnd) {
    return <HighlightedLine line={line} width={width} scrollX={scrollX} />
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
      <HighlightedText text={before} />
      <Text color="whiteBright" backgroundColor={input ? "green" : "white"}>
        {visibleCursorText}
      </Text>
      <HighlightedText text={after} />
      {" ".repeat(Math.max(0, width - renderedLength))}
    </>
  )
}

export type ViewEditLayout = {
  modalWidth: number
  modalHeight: number
  left: number
  top: number
  contentWidth: number
  contentHeight: number
}

export const buildViewEditLayout = (
  width: number,
  height: number,
  lineCount = 1,
): ViewEditLayout => {
  const modalWidth = Math.max(20, Math.min(width - 4, Math.floor(width * 0.8)))
  const modalHeight = Math.max(
    6,
    Math.min(height - 4, Math.floor(height * 0.75)),
  )
  const left = Math.max(0, Math.floor((width - modalWidth) / 2))
  const top = Math.max(0, Math.floor((height - modalHeight) / 2) - 2)
  const contentHeight = Math.max(1, modalHeight - 2 - paddingY * 2)
  const lineNumberWidth = String(Math.max(lineCount, contentHeight)).length
  const gutterWidth = lineNumberWidth + 2
  const contentWidth = Math.max(1, modalWidth - 2 - paddingX * 2 - gutterWidth)

  return {
    modalWidth,
    modalHeight,
    left,
    top,
    contentWidth,
    contentHeight,
  }
}

export const ViewEdit = ({
  fileName,
  content,
  width,
  height,
  scrollX,
  scrollY,
  isEditing = false,
  cursorX = 0,
  cursorY = 0,
  input = "",
  isSavePromptOpen = false,
  selectedSaveAction = "yes",
}: ViewEditProps) => {
  const contentLines = content.split("\n")
  const { modalWidth, modalHeight, left, top, contentWidth, contentHeight } =
    buildViewEditLayout(width, height, contentLines.length)
  const lineNumberWidth = String(
    Math.max(contentLines.length, contentHeight),
  ).length
  const title = isEditing ? `${fileName} (editing)` : fileName
  const lines = contentLines.slice(scrollY, scrollY + contentHeight)

  while (lines.length < contentHeight) {
    lines.push("")
  }

  return (
    <Box
      position="absolute"
      left={left}
      top={top}
      width={modalWidth}
      height={modalHeight}
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
    >
      <Box position="absolute" top={-1} left={-1}>
        <Text color="whiteBright" backgroundColor="gray">
          {"Esc"}
        </Text>
      </Box>
      <Box
        position="absolute"
        top={-1}
        left={Math.max(2, Math.floor((modalWidth - title.length) / 2))}
      >
        <Text bold>{` ${title.slice(0, Math.max(1, modalWidth - 6))} `}</Text>
      </Box>
      {Array.from({ length: paddingY }).map((_, index) => (
        <Text key={`padding-top-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {lines.map((line, index) => (
        <Text key={`${fileName}-${index}`}>
          {" ".repeat(paddingX)}
          <Text dimColor>
            {String(scrollY + index + 1).padStart(lineNumberWidth, " ")}
            {" │"}
          </Text>
          {isEditing && scrollY + index === cursorY ? (
            <EditableLine
              line={line}
              width={contentWidth}
              scrollX={scrollX}
              cursorX={cursorX}
              input={input}
            />
          ) : (
            <HighlightedLine
              line={line}
              width={contentWidth}
              scrollX={scrollX}
            />
          )}
          {" ".repeat(paddingX)}
        </Text>
      ))}
      {Array.from({ length: paddingY }).map((_, index) => (
        <Text key={`padding-bottom-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {isSavePromptOpen && (
        <Box
          position="absolute"
          top={Math.max(1, Math.floor(modalHeight / 2) - 2)}
          left={Math.max(2, Math.floor(modalWidth / 2) - 10)}
          width={20}
          height={5}
          borderStyle="single"
          borderColor={borderColor}
          flexDirection="column"
          alignItems="center"
        >
          <Text>{"Save it?"}</Text>
          <Text>
            <Text
              color={selectedSaveAction === "yes" ? "black" : undefined}
              backgroundColor={
                selectedSaveAction === "yes" ? "white" : undefined
              }
            >
              {" Yes "}
            </Text>
            {"  "}
            <Text
              color={selectedSaveAction === "no" ? "black" : undefined}
              backgroundColor={
                selectedSaveAction === "no" ? "white" : undefined
              }
            >
              {" No "}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}
