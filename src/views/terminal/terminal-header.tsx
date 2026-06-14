import React from "react"
import { Box, Text } from "ink"
import { headerHeight, requestStatsHeight } from "./constants.ts"

type TerminalHeaderProps = {
  width: number
  version?: string
  timeSpentMs: number
}

export const TerminalHeader = ({
  width,
  version,
  timeSpentMs,
}: TerminalHeaderProps) => {
  return (
    <>
      <Box flexDirection="column" width={width} height={headerHeight}>
        <Text bold>{">_ Ntee R1quest"}</Text>
        {version && <Text color="#006400">{`ver: ${version}`}</Text>}
      </Box>
      <Box width={width} height={requestStatsHeight}>
        <Text>{`◷ Time Spend ${timeSpentMs} ms,`}</Text>
      </Box>
    </>
  )
}
