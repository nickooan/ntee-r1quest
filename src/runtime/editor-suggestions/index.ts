import { readFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type EditorSuggestionKind = "keyword" | "macro" | "definition"

export type EditorSuggestionItem = {
  label: string
  insertText: string
  cursorOffset?: number
  kind: EditorSuggestionKind
}

type CachedDefinition = {
  mtimeMs: number
  keys: string[]
}

const definitionCache = new Map<string, CachedDefinition>()

export const requestKeywordSuggestions: EditorSuggestionItem[] = [
  "ref",
  "url",
  "type",
  "header",
  "authorization",
  "auth",
  "body",
].map((keyword) => ({
  label: keyword,
  insertText: `${keyword} `,
  kind: "keyword",
}))

export const requestMacroSuggestions: EditorSuggestionItem[] = [
  {
    label: "@i",
    insertText: "@i()",
    cursorOffset: 3,
    kind: "macro",
  },
  {
    label: "@f",
    insertText: "@f()",
    cursorOffset: 3,
    kind: "macro",
  },
  {
    label: "@env",
    insertText: "@env()",
    cursorOffset: 5,
    kind: "macro",
  },
]

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
    ...requestMacroSuggestions,
    ...definitionMacroSuggestions,
    ...definitionSuggestions,
  ]
}
