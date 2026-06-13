import { Box, Text } from "ink"
import { BlinkingCursor } from "./blinking-cursor.tsx"
import { commandBackgroundColor, commandLineHeight } from "./constants.ts"

type CommandLineProps = {
  width: number
  prompt: string
  inputBeforeCursor: string
  inputAfterCursor: string
  cursorBlinkActive: boolean
  cursorActivityId: number
}

export const CommandLine = ({
  width,
  prompt,
  inputBeforeCursor,
  inputAfterCursor,
  cursorBlinkActive,
  cursorActivityId,
}: CommandLineProps) => {
  return (
    <Box
      width={width}
      height={commandLineHeight}
      backgroundColor={commandBackgroundColor}
    >
      <Text backgroundColor={commandBackgroundColor}>{prompt}</Text>
      <Text backgroundColor={commandBackgroundColor}>{inputBeforeCursor}</Text>
      <BlinkingCursor
        active={cursorBlinkActive}
        activityId={cursorActivityId}
        bold
        backgroundColor={commandBackgroundColor}
      />
      <Text backgroundColor={commandBackgroundColor}>{inputAfterCursor}</Text>
    </Box>
  )
}
