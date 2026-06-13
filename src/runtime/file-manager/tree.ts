import { readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { isInsideRoot } from "./path.ts"
import type { FileTreeEntry } from "./types.ts"

type DirectoryEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
}

type CachedDirectory = {
  mtimeMs: number
  entries: DirectoryEntry[]
}

// Cache directory listings keyed by absolute path, invalidated by the
// directory's mtime (which changes on add/remove/rename). buildFileTreeEntries
// runs on every keystroke that changes the command path, so this avoids a
// recursive readdir + sort of the whole tree each time — only a cheap stat
// remains on a cache hit.
const directoryCache = new Map<string, CachedDirectory>()

const readDirectorySorted = (directoryPath: string): DirectoryEntry[] => {
  const stats = statSync(directoryPath)
  const cached = directoryCache.get(directoryPath)

  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.entries
  }

  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }))
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })

  directoryCache.set(directoryPath, { mtimeMs: stats.mtimeMs, entries })

  return entries
}

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
      const directoryEntries = readDirectorySorted(resolvedDirectory)

      for (const entry of directoryEntries) {
        const relativeEntryPath = directoryPath
          ? `${directoryPath}/${entry.name}`
          : entry.name

        if (entry.isDirectory) {
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

        if (!entry.isFile) {
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

  // Single pass that lowercases each entry once and keeps the best match by
  // priority (exact > prefix > substring), instead of up to three full
  // findIndex passes each re-lowercasing every entry.
  let startsWithIndex = -1
  let includesIndex = -1

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]

    if (!entry) {
      continue
    }

    const commandValue = entry.commandValue.toLowerCase()
    const name = entry.name.toLowerCase()

    if (commandValue === normalizedInput || name === normalizedInput) {
      return index
    }

    if (
      startsWithIndex === -1 &&
      (commandValue.startsWith(normalizedInput) ||
        name.startsWith(normalizedInput))
    ) {
      startsWithIndex = index
    }

    if (
      includesIndex === -1 &&
      (commandValue.includes(normalizedInput) || name.includes(normalizedInput))
    ) {
      includesIndex = index
    }
  }

  return startsWithIndex !== -1 ? startsWithIndex : includesIndex
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

  const normalizedInput = input.trim().replaceAll("\\", "/")
  const pathParts = normalizedInput.split("/").filter(Boolean)

  for (let index = pathParts.length - 1; index > 0; index -= 1) {
    const parentCommand = `${pathParts.slice(0, index).join("/")}/`
    const parentIndex = entries.findIndex((entry) => {
      return entry.type === "directory" && entry.commandValue === parentCommand
    })

    if (parentIndex !== -1) {
      return parentIndex
    }
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
