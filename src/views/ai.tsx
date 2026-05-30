import React from "react"
import { Box, Text } from "ink"

export type AiChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiProps = {
  width: number
  height: number
  input: string
  inputCursorX?: number
  isCursorVisible?: boolean
  messages?: AiChatMessage[]
  scrollY?: number
  permissionMessage?: string
  isPending?: boolean
  pendingFrameIndex?: number
}

const borderColor = "#5a5a5a"
const permissionModalBackgroundColor = "#1f1f1f"
const pendingFrames = [".", "..", "..."]
const paddingX = 1
const paddingY = 1
const bottomPaddingY = 0

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
}

export type AiLayout = {
  modalWidth: number
  modalHeight: number
  left: number
  top: number
  contentWidth: number
  contentHeight: number
}

export const buildAiLayout = (width: number, height: number): AiLayout => {
  const modalWidth = Math.max(20, Math.min(width - 4, Math.floor(width * 0.8)))
  const modalHeight = Math.max(
    6,
    Math.min(height - 4, Math.floor(height * 0.75)),
  )
  const left = Math.max(0, Math.floor((width - modalWidth) / 2))
  const top = Math.max(0, Math.floor((height - modalHeight) / 2) - 2)
  const contentWidth = Math.max(1, modalWidth - 2 - paddingX * 2)
  const contentHeight = Math.max(
    1,
    modalHeight - 2 - paddingY - bottomPaddingY - 1,
  )

  return {
    modalWidth,
    modalHeight,
    left,
    top,
    contentWidth,
    contentHeight,
  }
}

const splitMessageContent = (content: string): string[] => {
  return content.split("\n").flatMap((line) => {
    if (line.length === 0) {
      return [""]
    }

    return line
  })
}

const wrapLine = (line: string, width: number): string[] => {
  if (line.length === 0) {
    return [""]
  }

  const chunks: string[] = []

  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width))
  }

  return chunks
}

const wrapLines = (lines: string[], width: number): string[] => {
  return lines.flatMap((line) => wrapLine(line, width))
}

const buildMessageLines = (message: AiChatMessage, width: number): string[] => {
  const lines = splitMessageContent(message.content)
  const prefix = "USER: "
  const suffix = " :AI"
  const contentWidth = Math.max(1, width - prefix.length)

  if (message.role === "user") {
    return wrapLines(lines, contentWidth).map((line, index) => {
      return `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`.padEnd(
        width,
        " ",
      )
    })
  }

  const title = " AI Response "
  const assistantContentWidth = Math.max(1, width - suffix.length)
  const visibleLines = wrapLines(lines, assistantContentWidth)
  const responseWidth = Math.min(
    width,
    Math.max(
      title.length + 4,
      ...visibleLines.map((line, index) => {
        return line.length + (index === 0 ? suffix.length : 0)
      }),
    ),
  )
  const ruleWidth = Math.max(0, responseWidth - title.length)
  const leftRuleWidth = Math.floor(ruleWidth / 2)
  const rightRuleWidth = ruleWidth - leftRuleWidth
  const titleLine =
    `${"-".repeat(leftRuleWidth)}${title}${"-".repeat(rightRuleWidth)}`.padStart(
      width,
      " ",
    )
  const responseLines = visibleLines.map((line, index) => {
    const content = `${line}${index === 0 ? suffix : ""}`

    return content.padStart(responseWidth, " ").padStart(width, " ")
  })

  return [" ".repeat(width), titleLine, ...responseLines, " ".repeat(width)]
}

export const buildAiMessageLines = (
  messages: AiChatMessage[],
  width: number,
): Array<{ key: string; role: AiChatMessage["role"]; content: string }> => {
  return messages.flatMap((message, messageIndex) => {
    return buildMessageLines(message, width).map((content, lineIndex) => ({
      key: `${messageIndex}-${lineIndex}-${message.role}`,
      role: message.role,
      content,
    }))
  })
}

const buildVisibleMessageLines = (
  messages: AiChatMessage[],
  height: number,
  width: number,
  scrollY: number,
  pendingFrameIndex?: number,
): Array<{ key: string; role: AiChatMessage["role"]; content: string }> => {
  const lines = buildAiMessageLines(messages, width)
  const nextLines =
    pendingFrameIndex === undefined
      ? lines
      : [
          ...lines,
          {
            key: `pending-${pendingFrameIndex}`,
            role: "assistant" as const,
            content:
              `AI is thinking${pendingFrames[pendingFrameIndex % pendingFrames.length]}`.padStart(
                width,
                " ",
              ),
          },
        ]
  const maxScrollY = Math.max(0, nextLines.length - height)
  const safeScrollY = maxScrollY - Math.min(Math.max(scrollY, 0), maxScrollY)

  return nextLines.slice(safeScrollY, safeScrollY + height)
}

const PermissionModal = ({
  width,
  height,
  message,
}: {
  width: number
  height: number
  message: string
}) => {
  const modalWidth = Math.max(20, Math.min(width - 4, 56))
  const modalHeight = 7
  const left = Math.max(0, Math.floor((width - modalWidth) / 2))
  const top = Math.max(0, Math.floor((height - modalHeight) / 2))
  const contentWidth = Math.max(1, modalWidth - 4)

  return (
    <Box
      position="absolute"
      left={left}
      top={top}
      width={modalWidth}
      height={modalHeight}
      borderStyle="single"
      borderColor="yellow"
      backgroundColor={permissionModalBackgroundColor}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold backgroundColor={permissionModalBackgroundColor}>
        {"Permission request".padEnd(contentWidth, " ")}
      </Text>
      <Text backgroundColor={permissionModalBackgroundColor}>
        {message.slice(0, contentWidth).padEnd(contentWidth, " ")}
      </Text>
      <Text backgroundColor={permissionModalBackgroundColor}>
        {" ".repeat(contentWidth)}
      </Text>
      <Text backgroundColor={permissionModalBackgroundColor}>
        <Text color="green" backgroundColor={permissionModalBackgroundColor}>
          {"Y"}
        </Text>
        {" Yes    "}
        <Text color="red" backgroundColor={permissionModalBackgroundColor}>
          {"N"}
        </Text>
        {" No"}
        {" ".repeat(Math.max(0, contentWidth - "Y Yes    N No".length))}
      </Text>
    </Box>
  )
}

export const Ai = ({
  width,
  height,
  input,
  inputCursorX = input.length,
  isCursorVisible = true,
  messages = [],
  scrollY = 0,
  permissionMessage,
  isPending = false,
  pendingFrameIndex = 0,
}: AiProps) => {
  const { modalWidth, modalHeight, left, top, contentWidth, contentHeight } =
    buildAiLayout(width, height)
  const visibleMessages = buildVisibleMessageLines(
    messages,
    contentHeight,
    contentWidth,
    scrollY,
    isPending ? pendingFrameIndex : undefined,
  )
  const inputPrefix = "> "
  const inputContentWidth = Math.max(0, contentWidth - inputPrefix.length)
  const safeInputCursorX = clampInputCursor(input, inputCursorX)
  const visibleInputStart =
    inputContentWidth <= 1
      ? 0
      : Math.min(
          Math.max(0, safeInputCursorX - inputContentWidth + 1),
          Math.max(0, input.length - inputContentWidth + 1),
        )
  const visibleInput = input.slice(
    visibleInputStart,
    visibleInputStart + inputContentWidth,
  )
  const visibleInputCursorX = clampInputCursor(
    visibleInput,
    safeInputCursorX - visibleInputStart,
  )
  const inputBeforeCursor = visibleInput.slice(0, visibleInputCursorX)
  const inputAfterCursor = visibleInput.slice(
    visibleInputCursorX,
    Math.max(visibleInputCursorX, inputContentWidth - 1),
  )
  const inputLineLength =
    inputPrefix.length + inputBeforeCursor.length + 1 + inputAfterCursor.length

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
        left={Math.max(2, Math.floor((modalWidth - "AI Chat".length) / 2))}
      >
        <Text bold>{" AI Chat "}</Text>
      </Box>
      {Array.from({ length: paddingY }).map((_, index) => (
        <Text key={`padding-top-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {visibleMessages.map((line) => (
        <Text key={line.key}>
          {" ".repeat(paddingX)}
          <Text bold={line.role === "user"}>{line.content}</Text>
          {" ".repeat(paddingX)}
        </Text>
      ))}
      {Array.from({
        length: Math.max(0, contentHeight - visibleMessages.length),
      }).map((_, index) => (
        <Text key={`empty-chat-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      <Text>
        {" ".repeat(paddingX)}
        <Text color="cyan">{inputPrefix}</Text>
        {inputBeforeCursor}
        <Text bold>{isCursorVisible ? "_" : " "}</Text>
        {inputAfterCursor}
        {" ".repeat(Math.max(0, contentWidth - inputLineLength))}
        {" ".repeat(paddingX)}
      </Text>
      {Array.from({ length: bottomPaddingY }).map((_, index) => (
        <Text key={`padding-bottom-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {permissionMessage && (
        <PermissionModal
          width={modalWidth}
          height={modalHeight}
          message={permissionMessage}
        />
      )}
    </Box>
  )
}
