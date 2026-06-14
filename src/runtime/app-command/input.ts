import type { ParsedAppCommandInput } from "./types.ts"

export const parseAppCommandInput = (
  input: string,
): ParsedAppCommandInput | null => {
  const source = input.trim()

  if (!source) {
    return null
  }

  const [name = "", ...args] = source.split(/\s+/)

  return {
    source,
    name,
    args,
  }
}
