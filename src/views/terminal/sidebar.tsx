import React, { memo } from "react"
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
  title?: string
  // When provided (History mode), the sidebar lists these endpoint labels
  // instead of the file tree, highlighting the selected one.
  endpoints?: string[]
  selectedEndpointIndex?: number
}

export const Sidebar = memo(function Sidebar({
  entries,
  highlightedIndex,
  width,
  height,
  title = "Collections",
  endpoints,
  selectedEndpointIndex = 0,
}: SidebarProps) {
  const viewportHeight = Math.max(1, height - 2)

  if (endpoints) {
    return (
      <EndpointSidebar
        endpoints={endpoints}
        selectedIndex={selectedEndpointIndex}
        viewportHeight={viewportHeight}
        title={title}
        width={width}
        height={height}
      />
    )
  }

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
      <PaneTitle title={title} width={width} />
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
})

const EndpointSidebar = ({
  endpoints,
  selectedIndex,
  viewportHeight,
  title,
  width,
  height,
}: {
  endpoints: string[]
  selectedIndex: number
  viewportHeight: number
  title: string
  width: number
  height: number
}) => {
  const innerWidth = Math.max(1, width - 2)
  const startIndex = Math.min(
    Math.max(0, selectedIndex - viewportHeight + 1),
    Math.max(0, endpoints.length - viewportHeight),
  )
  const visible = endpoints.slice(startIndex, startIndex + viewportHeight)

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={paneBorderColor}
      position="relative"
    >
      <PaneTitle title={title} width={width} />
      {visible.map((label, index) => {
        const isHighlighted = startIndex + index === selectedIndex

        return (
          <Text
            key={label}
            color={isHighlighted ? "black" : "yellow"}
            backgroundColor={isHighlighted ? "yellow" : undefined}
            dimColor={!isHighlighted}
          >
            {` ${label} `.slice(0, innerWidth).padEnd(innerWidth, " ")}
          </Text>
        )
      })}
      {Array.from({
        length: Math.max(0, viewportHeight - visible.length),
      }).map((_, index) => (
        <Text key={`empty-endpoint-${index}`}>{" ".repeat(innerWidth)}</Text>
      ))}
    </Box>
  )
}
