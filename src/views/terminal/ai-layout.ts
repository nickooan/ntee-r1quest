// Pure AI overlay geometry and message-line building, extracted from ai.tsx so
// the layout/line logic ports to Go independently of the Ink rendering. No React.
import type { AiChatMessage } from "../key-helpers/index.ts"

const pendingFrames = [".", "..", "..."]
export const paddingX = 1
export const paddingY = 1
export const bottomPaddingY = 0

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

const buildMessageLines = (
  message: AiChatMessage,
  width: number,
  agentName: string,
): string[] => {
  if (message.role === "divider") {
    const label = " above is history "
    const ruleWidth = Math.max(0, width - label.length)
    const leftWidth = Math.floor(ruleWidth / 2)
    const rightWidth = ruleWidth - leftWidth

    return [
      `${"─".repeat(leftWidth)}${label}${"─".repeat(rightWidth)}`.slice(
        0,
        width,
      ),
    ]
  }

  const lines = splitMessageContent(message.content)
  const prefix = "USER: "
  const suffix = ` :${agentName}`
  const contentWidth = Math.max(1, width - prefix.length)

  if (message.role === "user") {
    return wrapLines(lines, contentWidth).map((line, index) => {
      return `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`.padEnd(
        width,
        " ",
      )
    })
  }

  const title = ` ${agentName} Response `
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
  agentName = "AI",
): Array<{ key: string; role: AiChatMessage["role"]; content: string }> => {
  return messages.flatMap((message, messageIndex) => {
    return buildMessageLines(message, width, agentName).map(
      (content, lineIndex) => ({
        key: `${messageIndex}-${lineIndex}-${message.role}`,
        role: message.role,
        content,
      }),
    )
  })
}

export const buildVisibleAiMessageLines = (
  messages: AiChatMessage[],
  height: number,
  width: number,
  scrollY: number,
  pendingFrameIndex?: number,
  isOffline = false,
  agentName = "AI",
): Array<{ key: string; role: AiChatMessage["role"]; content: string }> => {
  const lines = buildAiMessageLines(messages, width, agentName)
  const nextLines = [...lines]

  if (isOffline) {
    nextLines.push({
      key: "offline",
      role: "assistant" as const,
      content: `${agentName} is offline`.padStart(width, " "),
    })
  } else if (pendingFrameIndex !== undefined) {
    nextLines.push({
      key: `pending-${pendingFrameIndex}`,
      role: "assistant" as const,
      content:
        `${agentName} is thinking${pendingFrames[pendingFrameIndex % pendingFrames.length]}`.padStart(
          width,
          " ",
        ),
    })
  }
  const maxScrollY = Math.max(0, nextLines.length - height)
  const safeScrollY = maxScrollY - Math.min(Math.max(scrollY, 0), maxScrollY)

  return nextLines.slice(safeScrollY, safeScrollY + height)
}
