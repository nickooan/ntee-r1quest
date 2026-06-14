import { Box, Text } from "ink"

const overlayBackgroundColor = "#1f1f1f"

type SearchNotFoundOverlayProps = {
  width: number
  height: number
  query: string
}

export const SearchNotFoundOverlay = ({
  width,
  height,
  query,
}: SearchNotFoundOverlayProps) => {
  const modalWidth = Math.max(20, Math.min(width - 4, 48))
  const modalHeight = 6
  const left = Math.max(0, Math.floor((width - modalWidth) / 2))
  const top = Math.max(0, Math.floor((height - modalHeight) / 2))
  const contentWidth = Math.max(1, modalWidth - 4)
  const message = `No matches for "${query}"`

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
        {"Nothing found".padEnd(contentWidth, " ")}
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
