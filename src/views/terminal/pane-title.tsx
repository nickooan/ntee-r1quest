import React from "react"
import { Box, Text } from "ink"

type PaneTitleProps = {
  title: string
  width: number
}

export const PaneTitle = ({ title, width }: PaneTitleProps) => {
  const label = ` ${title} `.slice(0, Math.max(0, width - 4))

  return (
    <Box position="absolute" top={-1} left={2}>
      <Text color="white">{label}</Text>
    </Box>
  )
}
