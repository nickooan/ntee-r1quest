import { Box, Text } from "ink"

const overlayBackgroundColor = "#1f1f1f"

type CacheNoticeOverlayProps = {
  width: number
  height: number
}

/** Modal shown after `@clean-cache`/`@cc` clears the cache. Enter dismisses. */
export const CacheNoticeOverlay = ({
  width,
  height,
}: CacheNoticeOverlayProps) => {
  const modalWidth = Math.max(20, Math.min(width - 4, 44))
  const modalHeight = 5
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
      borderColor="green"
      backgroundColor={overlayBackgroundColor}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="green" backgroundColor={overlayBackgroundColor}>
        {"Cache erased".padEnd(contentWidth, " ")}
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
