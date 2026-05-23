import React from "react"
import { Box, Text } from "ink"
import {
  buildFileTreeViewport,
  formatFileTreeEntryParts,
  type FileTreeEntry,
} from "../../runtime/file-manager/index.ts"
import { paneBorderColor } from "./constants.ts"
import { PaneTitle } from "./pane-title.tsx"

type SidebarProps = {
  entries: FileTreeEntry[]
  highlightedIndex: number
  width: number
  height: number
}

export const Sidebar = ({
  entries,
  highlightedIndex,
  width,
  height,
}: SidebarProps) => {
  const viewportHeight = Math.max(1, height - 2)
  const viewport = buildFileTreeViewport(
    entries,
    viewportHeight,
    0,
    highlightedIndex,
  )

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={paneBorderColor}
      position="relative"
    >
      <PaneTitle title="Collections" width={width} />
      {viewport.entries.map((entry, index) => {
        const entryIndex = viewport.safeScrollY + index
        const isHighlighted = entryIndex === highlightedIndex
        const labelParts = formatFileTreeEntryParts(
          entry,
          Math.max(1, width - 2),
        )
        const textColor = isHighlighted ? "black" : undefined
        const backgroundColor = isHighlighted ? "yellow" : undefined
        const dimColor = !isHighlighted

        return (
          <Text
            key={entry.relativePath}
            color={textColor}
            backgroundColor={backgroundColor}
            dimColor={dimColor}
          >
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
            >
              {labelParts.indent}
            </Text>
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
              bold={entry.type === "directory"}
            >
              {labelParts.marker}
            </Text>
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              dimColor={dimColor}
            >
              {labelParts.name}
              {labelParts.padding}
            </Text>
          </Text>
        )
      })}
      {Array.from({
        length: Math.max(0, viewportHeight - viewport.entries.length),
      }).map((_, index) => (
        <Text key={`empty-tree-${index}`}>
          {" ".repeat(Math.max(1, width - 2))}
        </Text>
      ))}
    </Box>
  )
}
