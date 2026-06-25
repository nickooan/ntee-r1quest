import React, { memo, useMemo } from "react"
import { Box, Text } from "ink"
import type { CustomCommand } from "../runtime/custom-command/index.ts"
import { BlinkingCursor } from "./terminal/blinking-cursor.tsx"
import {
  bottomPaddingY,
  buildAiLayout,
  buildVisibleAiMessageLines,
  paddingX,
  paddingY,
} from "./terminal/ai-layout.ts"

// Single source of truth lives with the AI mode state in key-helpers.
export type { AiChatMessage } from "./key-helpers/index.ts"
import type { AiChatMessage } from "./key-helpers/index.ts"

export type AiProps = {
  width: number
  height: number
  input: string
  inputCursorX?: number
  cursorBlinkActive?: boolean
  cursorActivityId?: number
  messages?: AiChatMessage[]
  scrollY?: number
  commandSuggestions?: CustomCommand[]
  commandSuggestionIndex?: number
  permissionMessage?: string
  isPending?: boolean
  isOffline?: boolean
  pendingFrameIndex?: number
  // Display name of the chosen agent (e.g. "Claude"); labels the overlay.
  agentName?: string
}

const borderColor = "yellow"
const permissionModalBackgroundColor = "#1f1f1f"
// Darker than the overlay so the input bar reads as a distinct field.
const inputBackgroundColor = "#0a0a0a"

const clampInputCursor = (input: string, inputCursorX: number): number => {
  return Math.min(Math.max(inputCursorX, 0), input.length)
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

const maxCommandSuggestionItems = 6

const CommandSuggestionsOverlay = ({
  modalWidth,
  modalHeight,
  suggestions,
  selectedIndex,
}: {
  modalWidth: number
  modalHeight: number
  suggestions: CustomCommand[]
  selectedIndex: number
}) => {
  const visibleCount = Math.min(suggestions.length, maxCommandSuggestionItems)
  const safeIndex = Math.min(Math.max(selectedIndex, 0), suggestions.length - 1)
  const startIndex = Math.min(
    Math.max(0, safeIndex - visibleCount + 1),
    Math.max(0, suggestions.length - visibleCount),
  )
  const visibleSuggestions = suggestions.slice(
    startIndex,
    startIndex + visibleCount,
  )
  const overlayWidth = Math.max(1, modalWidth - 4)
  // Sit just above the input line near the bottom of the modal.
  const top = Math.max(1, modalHeight - 3 - visibleCount)

  return (
    <Box
      position="absolute"
      left={2}
      top={top}
      width={overlayWidth}
      height={visibleCount}
      flexDirection="column"
    >
      {visibleSuggestions.map((command, index) => {
        const isSelected = startIndex + index === safeIndex
        const description = command.description
          ? `  ${command.description}`
          : ""
        const text = `/${command.name}${description}`
          .slice(0, overlayWidth)
          .padEnd(overlayWidth, " ")

        return (
          <Text
            key={command.name}
            color={isSelected ? "white" : "black"}
            backgroundColor={isSelected ? "#006400" : "white"}
          >
            {text}
          </Text>
        )
      })}
    </Box>
  )
}

export const Ai = memo(function Ai({
  width,
  height,
  input,
  inputCursorX = input.length,
  cursorBlinkActive = true,
  cursorActivityId = 0,
  messages = [],
  scrollY = 0,
  commandSuggestions = [],
  commandSuggestionIndex = 0,
  permissionMessage,
  isPending = false,
  isOffline = false,
  pendingFrameIndex = 0,
  agentName = "AI",
}: AiProps) {
  const { modalWidth, modalHeight, left, top, contentWidth, contentHeight } =
    buildAiLayout(width, height)
  const visibleMessages = useMemo(
    () =>
      buildVisibleAiMessageLines(
        messages,
        contentHeight,
        contentWidth,
        scrollY,
        isPending ? pendingFrameIndex : undefined,
        isOffline,
        agentName,
      ),
    [
      messages,
      contentHeight,
      contentWidth,
      scrollY,
      isPending,
      pendingFrameIndex,
      isOffline,
      agentName,
    ],
  )
  const chatTitle = ` ${agentName} Chat `
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
      backgroundColor={permissionModalBackgroundColor}
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
        left={Math.max(2, Math.floor((modalWidth - chatTitle.length) / 2))}
      >
        <Text bold>{chatTitle}</Text>
      </Box>
      {Array.from({ length: paddingY }).map((_, index) => (
        <Text key={`padding-top-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {visibleMessages.map((line) => (
        <Text key={line.key}>
          {" ".repeat(paddingX)}
          <Text
            bold={line.role === "user"}
            dimColor={line.role === "divider"}
            color={line.key === "offline" ? "red" : undefined}
          >
            {line.content}
          </Text>
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
      <Text backgroundColor={inputBackgroundColor}>
        {" ".repeat(paddingX)}
        <Text color="cyan" backgroundColor={inputBackgroundColor}>
          {inputPrefix}
        </Text>
        {inputBeforeCursor}
        <BlinkingCursor
          active={cursorBlinkActive}
          activityId={cursorActivityId}
          backgroundColor={inputBackgroundColor}
          bold
        />
        {inputAfterCursor}
        {" ".repeat(Math.max(0, contentWidth - inputLineLength))}
        {" ".repeat(paddingX)}
      </Text>
      {Array.from({ length: bottomPaddingY }).map((_, index) => (
        <Text key={`padding-bottom-${index}`}>
          {" ".repeat(Math.max(1, modalWidth - 2))}
        </Text>
      ))}
      {!permissionMessage && commandSuggestions.length > 0 && (
        <CommandSuggestionsOverlay
          modalWidth={modalWidth}
          modalHeight={modalHeight}
          suggestions={commandSuggestions}
          selectedIndex={commandSuggestionIndex}
        />
      )}
      {permissionMessage && (
        <PermissionModal
          width={modalWidth}
          height={modalHeight}
          message={permissionMessage}
        />
      )}
    </Box>
  )
})
