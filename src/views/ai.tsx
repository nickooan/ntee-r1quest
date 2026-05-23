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
  messages?: AiChatMessage[]
}

const borderColor = "#5a5a5a"
const paddingX = 1
const paddingY = 1

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
  const contentHeight = Math.max(1, modalHeight - 2 - paddingY * 2 - 1)

  return {
    modalWidth,
    modalHeight,
    left,
    top,
    contentWidth,
    contentHeight,
  }
}

const formatMessageLine = (
  message: AiChatMessage,
  width: number,
): { label: string; content: string } => {
  const label = message.role === "user" ? "You" : "AI"
  const prefix = `${label}: `
  const content = `${prefix}${message.content}`.slice(0, width)

  return {
    label,
    content: content.padEnd(width, " "),
  }
}

export const Ai = ({ width, height, input, messages = [] }: AiProps) => {
  const { modalWidth, modalHeight, left, top, contentWidth, contentHeight } =
    buildAiLayout(width, height)
  const visibleMessages = messages.slice(-contentHeight)
  const inputPrefix = "> "
  const visibleInput = `${inputPrefix}${input}`.slice(0, contentWidth)

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
      {visibleMessages.map((message, index) => {
        const line = formatMessageLine(message, contentWidth)

        return (
          <Text key={`${index}-${message.role}-${message.content}`}>
            {" ".repeat(paddingX)}
            <Text bold={message.role === "user"}>{line.content}</Text>
            {" ".repeat(paddingX)}
          </Text>
        )
      })}
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
        {input.slice(0, Math.max(0, contentWidth - inputPrefix.length))}
        {" ".repeat(Math.max(0, contentWidth - visibleInput.length))}
        {" ".repeat(paddingX)}
      </Text>
      {Array.from({ length: paddingY }).map((_, index) => (
        <Text key={`padding-bottom-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
    </Box>
  )
}
