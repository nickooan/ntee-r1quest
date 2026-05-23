import type { FileTreeEntry } from "./types.ts"

export const formatFileTreeEntryLabel = (
  entry: FileTreeEntry,
  width: number,
): string => {
  const indent = "  ".repeat(entry.depth)
  const marker =
    entry.type === "directory" ? (entry.isExpanded ? "↓ " : "→ ") : "  "
  const label = `${indent}${marker}${entry.name}`

  if (label.length > width) {
    return label.slice(0, Math.max(0, width - 1)).padEnd(width, " ")
  }

  return label.padEnd(width, " ")
}

export const formatFileTreeEntryParts = (
  entry: FileTreeEntry,
  width: number,
): {
  indent: string
  marker: string
  name: string
  padding: string
} => {
  const label = formatFileTreeEntryLabel(entry, width)
  const indent = "  ".repeat(entry.depth)
  const marker =
    entry.type === "directory" ? (entry.isExpanded ? "↓ " : "→ ") : "  "
  const prefixLength = Math.min(label.length, indent.length + marker.length)

  return {
    indent: label.slice(0, Math.min(label.length, indent.length)),
    marker: label.slice(indent.length, prefixLength),
    name: label.slice(prefixLength).trimEnd(),
    padding: " ".repeat(label.length - label.trimEnd().length),
  }
}
