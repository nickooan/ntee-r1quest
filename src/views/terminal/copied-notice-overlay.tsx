import { Box, Text } from "ink"

const overlayBackgroundColor = "#1f1f1f"

type CopyNoticeOverlayProps = {
  width: number
  height: number
}

type NoticeModalProps = CopyNoticeOverlayProps & {
  color: string
  title: string
  message: string
}

// Shared modal body for the copy result notices. Mirrors the search "Nothing
// found" overlay style; Enter dismisses it (handled by the caller).
const NoticeModal = ({
  width,
  height,
  color,
  title,
  message,
}: NoticeModalProps) => {
  const modalWidth = Math.max(20, Math.min(width - 4, 48))
  const modalHeight = 6
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
      borderColor={color}
      backgroundColor={overlayBackgroundColor}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color={color} backgroundColor={overlayBackgroundColor}>
        {title.padEnd(contentWidth, " ")}
      </Text>
      <Text backgroundColor={overlayBackgroundColor}>
        {message.slice(0, contentWidth).padEnd(contentWidth, " ")}
      </Text>
      <Text backgroundColor={overlayBackgroundColor}>
        {" ".repeat(contentWidth)}
      </Text>
      <Text dimColor backgroundColor={overlayBackgroundColor}>
        {"Press Enter to dismiss".padEnd(contentWidth, " ")}
      </Text>
    </Box>
  )
}

/** Modal shown after `@report`/`@copy` copies the Result pane to the clipboard. */
export const CopiedNoticeOverlay = ({
  width,
  height,
}: CopyNoticeOverlayProps) => (
  <NoticeModal
    width={width}
    height={height}
    color="green"
    title="Copied"
    message="Result copied to clipboard"
  />
)

type CopyFailedNoticeOverlayProps = CopyNoticeOverlayProps & {
  message: string
}

/** Modal shown when `@report`/`@copy` could not copy the Result pane. */
export const CopyFailedNoticeOverlay = ({
  width,
  height,
  message,
}: CopyFailedNoticeOverlayProps) => (
  <NoticeModal
    width={width}
    height={height}
    color="yellow"
    title="Copy failed"
    message={message}
  />
)
