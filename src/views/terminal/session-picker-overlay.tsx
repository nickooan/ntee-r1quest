import { Box, Text } from "ink"
import type { AiSessionRecord } from "../../runtime/cache/index.ts"

const overlayBackgroundColor = "#1f1f1f"
const selectedBackgroundColor = "#006400"
const maxVisibleRows = 6

type SessionPickerOverlayProps = {
  width: number
  height: number
  agentName: string
  // Past sessions, ordered newest-first for display.
  sessions: AiSessionRecord[]
  // 0 selects "New session"; i + 1 selects sessions[i].
  selectedIndex: number
}

// ISO -> "YYYY-MM-DD HH:mm". Kept as a stable string slice rather than locale
// formatting so the list reads the same on every machine.
const formatTimestamp = (iso: string): string => {
  const value = iso.slice(0, 16).replace("T", " ")

  return value.length === 16 ? value : iso
}

/**
 * Shown on the first @ai when prior sessions exist. A keyboard-navigable list
 * with "New session" default-selected at the top and past sessions (with their
 * last-used time) below. Navigation/selection is driven by the parent, which
 * owns selectedIndex; this component only renders.
 */
export const SessionPickerOverlay = ({
  width,
  height,
  agentName,
  sessions,
  selectedIndex,
}: SessionPickerOverlayProps) => {
  const options = [
    { label: "✚ New session", hint: "" },
    ...sessions.map((session) => ({
      label: session.id,
      hint: formatTimestamp(session.updatedAt),
    })),
  ]

  const modalWidth = Math.max(28, Math.min(width - 4, 64))
  const contentWidth = Math.max(1, modalWidth - 4)
  const visibleCount = Math.min(options.length, maxVisibleRows)
  const startIndex = Math.min(
    Math.max(0, selectedIndex - visibleCount + 1),
    Math.max(0, options.length - visibleCount),
  )
  const visibleOptions = options.slice(startIndex, startIndex + visibleCount)
  // border(2) + title + hint + blank + rows.
  const modalHeight = visibleCount + 5
  const left = Math.max(0, Math.floor((width - modalWidth) / 2))
  const top = Math.max(0, Math.floor((height - modalHeight) / 2))

  return (
    <Box
      position="absolute"
      left={left}
      top={top}
      width={modalWidth}
      height={modalHeight}
      borderStyle="single"
      borderColor="yellow"
      backgroundColor={overlayBackgroundColor}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold backgroundColor={overlayBackgroundColor}>
        {`Resume ${agentName} session`
          .slice(0, contentWidth)
          .padEnd(contentWidth, " ")}
      </Text>
      <Text dimColor backgroundColor={overlayBackgroundColor}>
        {"↑/↓ choose · Enter confirm · Esc cancel"
          .slice(0, contentWidth)
          .padEnd(contentWidth, " ")}
      </Text>
      <Text backgroundColor={overlayBackgroundColor}>
        {" ".repeat(contentWidth)}
      </Text>
      {visibleOptions.map((option, index) => {
        const optionIndex = startIndex + index
        const isSelected = optionIndex === selectedIndex
        const prefix = isSelected ? "› " : "  "
        const hint = option.hint ? ` ${option.hint}` : ""
        const labelWidth = Math.max(
          1,
          contentWidth - prefix.length - hint.length,
        )
        const label = option.label.slice(0, labelWidth).padEnd(labelWidth, " ")
        const row = `${prefix}${label}${hint}`
          .slice(0, contentWidth)
          .padEnd(contentWidth, " ")

        return (
          <Text
            key={`${option.label}-${optionIndex}`}
            color={isSelected ? "white" : undefined}
            backgroundColor={
              isSelected ? selectedBackgroundColor : overlayBackgroundColor
            }
            bold={isSelected}
          >
            {row}
          </Text>
        )
      })}
    </Box>
  )
}
