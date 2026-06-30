import { NS, cacheGet, cachePut, openCache } from "./store.ts"

export type InputRecord = {
  count: number
  lastUsedAt: number
}

// Inputs prefixed with "@" are mode/app commands and are intentionally not
// cached.
const isCacheableInput = (input: string): boolean =>
  input.length > 0 && !input.startsWith("@")

/**
 * Records a user input in the shared query/view history. Dedupes by text,
 * bumping a usage count and recency timestamp. No-op for empty input or
 * "@" commands.
 */
export const recordInput = (rawInput: string): void => {
  const input = rawInput.trim()

  if (!isCacheableInput(input)) {
    return
  }

  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    const existing = cacheGet<InputRecord>(cache, NS.input + input)

    cachePut(cache, NS.input + input, {
      count: (existing?.count ?? 0) + 1,
      lastUsedAt: Date.now(),
    })
  } catch {
    // ignore cache write failures
  }
}

/**
 * Returns cached inputs that start with the given prefix, most-recently-used
 * first. Prefix matching uses LMDB's ordered keys for an efficient range scan.
 */
export const suggestInputs = (prefix: string, limit = 6): string[] => {
  const normalizedPrefix = prefix.trim()

  if (!isCacheableInput(normalizedPrefix)) {
    return []
  }

  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    const matches: Array<{ key: string; lastUsedAt: number }> = []

    // Prefix scan over the input namespace; keys come back as "input:<text>".
    for (const namespacedKey of cache.prefixScan(NS.input + normalizedPrefix)) {
      const text = namespacedKey.slice(NS.input.length)

      // Skip an exact match of what the user already typed.
      if (text === normalizedPrefix) {
        continue
      }

      const record = cacheGet<InputRecord>(cache, namespacedKey)

      if (record) {
        matches.push({ key: text, lastUsedAt: record.lastUsedAt })
      }
    }

    return matches
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, limit)
      .map((match) => match.key)
  } catch {
    return []
  }
}
