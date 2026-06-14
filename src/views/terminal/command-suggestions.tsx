import { Box, Text } from "ink"
import { commandBackgroundColor, commandLineHeight } from "./constants.ts"
import type { InputSuggestion } from "./input-suggestions.ts"

const maxVisibleSuggestions = 6

type CommandSuggestionOverlayProps = {
  suggestions: InputSuggestion[]
  selectedIndex: number
  width: number
  height: number
  left?: number
}

/**
 * Suggestion popup rendered just above the command line in query/view modes.
 * Cache entries use green text, file/directory ("collection") entries use
 * yellow text; the selected row follows the shared selected-suggestion style.
 */
export const CommandSuggestionOverlay = ({
  suggestions,
  selectedIndex,
  width,
  height,
  left = 0,
}: CommandSuggestionOverlayProps) => {
  if (suggestions.length === 0) {
    return null
  }

  const optionWidth = Math.max(
    1,
    ...suggestions.map((suggestion) => suggestion.label.length),
  )
  const overlayWidth = Math.min(
    Math.max(4, optionWidth + 2),
    Math.max(4, width - 2),
  )
  const visibleCount = Math.min(suggestions.length, maxVisibleSuggestions)
  const startIndex = Math.min(
    Math.max(0, selectedIndex - visibleCount + 1),
    Math.max(0, suggestions.length - visibleCount),
  )
  const visibleSuggestions = suggestions.slice(
    startIndex,
    startIndex + visibleCount,
  )
  const top = Math.max(
    0,
    height - commandLineHeight - visibleSuggestions.length,
  )

  return (
    <Box
      position="absolute"
      top={top}
      left={left}
      width={overlayWidth}
      height={visibleSuggestions.length}
      flexDirection="column"
    >
      {visibleSuggestions.map((suggestion, index) => {
        const isSelected = startIndex + index === selectedIndex
        const textColor = isSelected
          ? "white"
          : suggestion.source === "cache"
            ? "green"
            : "yellow"

        return (
          <Text
            key={`${suggestion.source}-${suggestion.label}`}
            color={textColor}
            backgroundColor={isSelected ? "#006400" : commandBackgroundColor}
            bold={isSelected}
          >
            {suggestion.label.padEnd(overlayWidth, " ").slice(0, overlayWidth)}
          </Text>
        )
      })}
    </Box>
  )
}
