// Shared layout primitives for the sectioned Results view used by both the
// live response view and the cached history view.

/** Indents every non-empty line of `text` by `pad` (blank lines stay blank). */
export const indentBlock = (text: string, pad = "  "): string =>
  text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n")

/** A section divider like `── Headers ─────────`, padded to `width` columns. */
export const sectionRule = (label: string, width: number): string => {
  const prefix = `── ${label} `
  return prefix + "─".repeat(Math.max(3, width - prefix.length))
}
