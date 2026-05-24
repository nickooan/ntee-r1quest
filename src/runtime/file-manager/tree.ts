import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { isInsideRoot } from "./path.ts"
import type { FileTreeEntry } from "./types.ts"

export const buildFileTreeEntries = (
  root: string | undefined,
  expandedDirectoryPaths: ReadonlySet<string> = new Set(),
): FileTreeEntry[] => {
  if (!root) {
    return []
  }

  const resolvedRoot = resolve(root)
  const entries: FileTreeEntry[] = []

  const appendDirectory = (directoryPath: string, depth: number) => {
    const resolvedDirectory = resolve(resolvedRoot, directoryPath)

    if (!isInsideRoot(resolvedRoot, resolvedDirectory)) {
      return
    }

    try {
      const directoryEntries = readdirSync(resolvedDirectory, {
        withFileTypes: true,
      }).sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      })

      for (const entry of directoryEntries) {
        const relativeEntryPath = directoryPath
          ? `${directoryPath}/${entry.name}`
          : entry.name

        if (entry.isDirectory()) {
          const isExpanded = expandedDirectoryPaths.has(relativeEntryPath)

          entries.push({
            name: entry.name,
            relativePath: relativeEntryPath,
            commandValue: `${relativeEntryPath}/`,
            depth,
            type: "directory",
            isExpanded,
          })

          if (isExpanded) {
            appendDirectory(relativeEntryPath, depth + 1)
          }

          continue
        }

        if (!entry.isFile()) {
          continue
        }

        const isRequest = entry.name.endsWith(".nts")
        const commandValue = isRequest
          ? relativeEntryPath.slice(0, -".nts".length)
          : relativeEntryPath

        entries.push({
          name: entry.name,
          relativePath: relativeEntryPath,
          commandValue,
          depth,
          type: isRequest ? "request" : "file",
          isExpanded: false,
        })
      }
    } catch {
      return
    }
  }

  appendDirectory("", 0)

  return entries
}

export const findFileTreeMatchIndex = (
  entries: FileTreeEntry[],
  input: string,
): number => {
  const normalizedInput = input.trim().replaceAll("\\", "/").toLowerCase()

  if (!normalizedInput || normalizedInput.startsWith("@")) {
    return -1
  }

  const exactIndex = entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase() === normalizedInput ||
      entry.name.toLowerCase() === normalizedInput
    )
  })

  if (exactIndex !== -1) {
    return exactIndex
  }

  const startsWithIndex = entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase().startsWith(normalizedInput) ||
      entry.name.toLowerCase().startsWith(normalizedInput)
    )
  })

  if (startsWithIndex !== -1) {
    return startsWithIndex
  }

  return entries.findIndex((entry) => {
    return (
      entry.commandValue.toLowerCase().includes(normalizedInput) ||
      entry.name.toLowerCase().includes(normalizedInput)
    )
  })
}

export const buildFileTreeViewport = (
  entries: FileTreeEntry[],
  height: number,
  scrollY: number,
  highlightedIndex: number,
): {
  entries: FileTreeEntry[]
  maxScrollY: number
  safeScrollY: number
} => {
  const maxScrollY = Math.max(0, entries.length - height)
  const nextScrollY =
    highlightedIndex === -1
      ? scrollY
      : highlightedIndex - Math.floor(Math.max(1, height) / 2)
  const safeScrollY = Math.min(Math.max(nextScrollY, 0), maxScrollY)
  const visibleEntries = entries.slice(safeScrollY, safeScrollY + height)

  return {
    entries: visibleEntries,
    maxScrollY,
    safeScrollY,
  }
}

export const buildExpandedDirectoryPaths = (
  commandValue: string,
): Set<string> => {
  const expandedDirectoryPaths = new Set<string>()
  const normalizedCommand = commandValue.trim().replaceAll("\\", "/")
  const pathParts = normalizedCommand.split("/").filter(Boolean)
  const directoryDepth = normalizedCommand.endsWith("/")
    ? pathParts.length
    : Math.max(0, pathParts.length - 1)

  for (let index = 1; index <= directoryDepth; index += 1) {
    expandedDirectoryPaths.add(pathParts.slice(0, index).join("/"))
  }

  return expandedDirectoryPaths
}

export const resolveHighlightedEntry = (
  entries: FileTreeEntry[],
  input: string,
): number => {
  const matchedIndex = findFileTreeMatchIndex(entries, input)

  if (matchedIndex !== -1) {
    return matchedIndex
  }

  return -1
}

export const resolveNextFileTreeSelectionIndex = (
  entries: FileTreeEntry[],
  highlightedIndex: number,
  direction: -1 | 1,
): number => {
  if (entries.length === 0) {
    return -1
  }

  if (highlightedIndex === -1) {
    return direction === 1 ? 0 : entries.length - 1
  }

  return Math.min(Math.max(highlightedIndex + direction, 0), entries.length - 1)
}
