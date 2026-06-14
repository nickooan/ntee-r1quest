import type { SearchMatch } from "../key-helpers/index.ts"

export type LineMatch = SearchMatch & { matchIndex: number }

// Stable empty reference so lines without matches don't get a fresh array each
// render (keeps memoized children from re-rendering).
export const noLineMatches: LineMatch[] = []

// Bucket matches by their line index once, preserving each match's global index
// (used for the focused-match highlight) and sorting each bucket by start. This
// replaces an O(lines × matches) scan-per-line with a single O(matches) pass.
export const buildMatchesByLine = (
  matches: SearchMatch[],
): Map<number, LineMatch[]> => {
  const matchesByLine = new Map<number, LineMatch[]>()

  matches.forEach((match, matchIndex) => {
    const entry: LineMatch = { ...match, matchIndex }
    const bucket = matchesByLine.get(match.lineIndex)

    if (bucket) {
      bucket.push(entry)
    } else {
      matchesByLine.set(match.lineIndex, [entry])
    }
  })

  for (const bucket of matchesByLine.values()) {
    bucket.sort((left, right) => left.start - right.start)
  }

  return matchesByLine
}
