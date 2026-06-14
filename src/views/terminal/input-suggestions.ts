import type { FileTreeEntry } from "../../runtime/file-manager/index.ts"
import { suggestInputs } from "../../runtime/cache/index.ts"

export type InputSuggestionSource = "cache" | "file" | "directory"

export type InputSuggestion = {
  label: string
  // Text the command line is set to when this suggestion is accepted.
  insertText: string
  source: InputSuggestionSource
  // The originating file tree entry, present for file/directory suggestions so
  // callers can reuse the existing open/descend behavior.
  entry?: FileTreeEntry
}

const maxInputSuggestions = 8

const normalizePath = (value: string): string =>
  value.trim().replaceAll("\\", "/").toLowerCase()

/**
 * Builds the combined query/view suggestion list shown above the command line:
 * current-directory file/directory entries that start with the typed path,
 * mixed with cached inputs that start with the typed text. "@" commands and
 * empty input produce no suggestions.
 *
 * The file tree entries are passed in (already memoized for the sidebar) so no
 * extra filesystem reads happen per keystroke.
 */
export const buildInputSuggestions = (
  fileTreeEntries: readonly FileTreeEntry[],
  command: string,
  limit = maxInputSuggestions,
): InputSuggestion[] => {
  const trimmed = command.trim()

  if (trimmed === "" || trimmed.startsWith("@")) {
    return []
  }

  const normalizedCommand = normalizePath(trimmed)
  const suggestions: InputSuggestion[] = []
  const seen = new Set<string>()

  const push = (suggestion: InputSuggestion) => {
    if (seen.has(suggestion.insertText)) {
      return
    }

    seen.add(suggestion.insertText)
    suggestions.push(suggestion)
  }

  // File/directory entries along the typed path, prefix-matched. Mirrors the
  // existing sidebar matching (commandValue / name startsWith), limited to
  // "starts with" per the agreed behavior.
  const exactMatches: FileTreeEntry[] = []
  const prefixMatches: FileTreeEntry[] = []

  for (const entry of fileTreeEntries) {
    const commandValue = entry.commandValue.toLowerCase()
    const name = entry.name.toLowerCase()

    if (commandValue === normalizedCommand || name === normalizedCommand) {
      exactMatches.push(entry)
    } else if (
      commandValue.startsWith(normalizedCommand) ||
      name.startsWith(normalizedCommand)
    ) {
      prefixMatches.push(entry)
    }
  }

  // Exact match first so the default (index 0) selection is what the user
  // typed, then prefix matches in tree order.
  for (const entry of [...exactMatches, ...prefixMatches]) {
    push({
      label: entry.commandValue,
      insertText: entry.commandValue,
      source: entry.type === "directory" ? "directory" : "file",
      entry,
    })
  }

  // Cached inputs (prefix match), excluding anything already offered as a file
  // entry above.
  for (const cached of suggestInputs(trimmed, limit)) {
    push({
      label: cached,
      insertText: cached,
      source: "cache",
    })
  }

  return suggestions.slice(0, limit)
}
