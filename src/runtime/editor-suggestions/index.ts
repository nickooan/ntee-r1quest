import { readdir } from "node:fs/promises"
import { readFileSync, statSync } from "node:fs"
import { basename, dirname, relative, resolve, sep } from "node:path"
import {
  requestHeaderSuggestions,
  requestKeywordSuggestions,
  requestMacroSuggestions,
  type EditorSuggestionItem,
} from "./items.ts"

export {
  requestHeaderSuggestions,
  requestKeywordSuggestions,
  requestMacroSuggestions,
  type EditorSuggestionItem,
  type EditorSuggestionKind,
} from "./items.ts"

type CachedDefinition = {
  mtimeMs: number
  keys: string[]
}

const definitionCache = new Map<string, CachedDefinition>()

const parseReferencedDefinitionPaths = (
  requestPath: string,
  content: string,
): string[] => {
  const requestDirectory = dirname(requestPath)

  return content
    .split("\n")
    .map((line) => line.match(/^\s*ref\s+([^\s]+\.ntd)\b/)?.[1])
    .filter((refPath): refPath is string => refPath !== undefined)
    .map((refPath) => resolve(requestDirectory, refPath))
}

const parseDefinitionKeys = (content: string): string[] => {
  const keys = new Set<string>()

  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:/)

    if (match?.[1]) {
      keys.add(match[1])
    }
  }

  return [...keys]
}

const readDefinitionKeys = (definitionPath: string): string[] => {
  try {
    const stats = statSync(definitionPath)
    const cached = definitionCache.get(definitionPath)

    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.keys
    }

    const keys = parseDefinitionKeys(readFileSync(definitionPath, "utf8"))

    definitionCache.set(definitionPath, {
      mtimeMs: stats.mtimeMs,
      keys,
    })

    return keys
  } catch {
    return []
  }
}

export const getReferencedDefinitionKeys = (
  requestPath: string,
  content: string,
): string[] => {
  const keys = new Set<string>()

  for (const definitionPath of parseReferencedDefinitionPaths(
    requestPath,
    content,
  )) {
    for (const key of readDefinitionKeys(definitionPath)) {
      keys.add(key)
    }
  }

  return [...keys].sort()
}

export const buildEditorSuggestionItems = (
  requestPath?: string,
  content = "",
): EditorSuggestionItem[] => {
  const definitionKeys =
    requestPath === undefined
      ? []
      : getReferencedDefinitionKeys(requestPath, content)
  const definitionSuggestions = definitionKeys.map((key) => ({
    label: key,
    insertText: key,
    kind: "definition" as const,
  }))
  const definitionMacroSuggestions = definitionKeys.map((key) => ({
    label: `@i(${key})`,
    insertText: `@i(${key})`,
    kind: "macro" as const,
  }))

  return [
    ...requestKeywordSuggestions,
    ...requestHeaderSuggestions,
    ...requestMacroSuggestions,
    ...definitionMacroSuggestions,
    ...definitionSuggestions,
  ]
}

const skippedRefFragments = new Set([".", "..", "/"])
const maxRefSuggestionItems = 50

const toRequestRelativePath = (
  requestDirectory: string,
  targetPath: string,
): string => {
  return relative(requestDirectory, targetPath).split(sep).join("/")
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason
  }
}

export const buildRefSuggestionItems = async (
  requestPath: string,
  fragment: string,
  signal?: AbortSignal,
): Promise<EditorSuggestionItem[]> => {
  if (
    !fragment ||
    skippedRefFragments.has(fragment) ||
    fragment.endsWith(".ntd")
  ) {
    return []
  }

  const requestDirectory = dirname(requestPath)
  const normalizedFragment = fragment.split("\\").join("/")
  const fragmentDirectory = normalizedFragment.endsWith("/")
    ? normalizedFragment
    : dirname(normalizedFragment)
  const fragmentBaseName = normalizedFragment.endsWith("/")
    ? ""
    : basename(normalizedFragment)
  const searchDirectory =
    fragmentDirectory === "."
      ? requestDirectory
      : resolve(requestDirectory, fragmentDirectory)
  const suggestions: EditorSuggestionItem[] = []

  throwIfAborted(signal)

  try {
    const entries = await readdir(searchDirectory, { withFileTypes: true })

    for (const entry of entries) {
      throwIfAborted(signal)

      const entryPath = resolve(searchDirectory, entry.name)
      const isDirectoryMatch =
        entry.isDirectory() && entry.name.startsWith(fragmentBaseName)
      const isNtdFileMatch =
        entry.isFile() &&
        entry.name.endsWith(".ntd") &&
        entry.name.startsWith(fragmentBaseName)

      if (isDirectoryMatch || isNtdFileMatch) {
        const refPath = isDirectoryMatch
          ? `${toRequestRelativePath(requestDirectory, entryPath)}/`
          : toRequestRelativePath(requestDirectory, entryPath)

        suggestions.push({
          label: refPath,
          insertText: refPath,
          kind: "ref",
        })
      }

      if (suggestions.length >= maxRefSuggestionItems) {
        break
      }
    }
  } catch (error) {
    throwIfAborted(signal)

    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }

  return suggestions
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, maxRefSuggestionItems)
}
