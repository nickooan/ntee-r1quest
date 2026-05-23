import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { isInsideRoot } from "./path.ts"
import type { FileTreeEntry, OpenViewFile } from "./types.ts"

export const readViewFile = (
  root: string | undefined,
  entry: FileTreeEntry,
): OpenViewFile | null => {
  if (!root || entry.type === "directory") {
    return null
  }

  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, entry.relativePath)

  if (!isInsideRoot(resolvedRoot, resolvedPath)) {
    return null
  }

  try {
    return {
      fileName: basename(entry.relativePath),
      path: resolvedPath,
      content: readFileSync(resolvedPath, "utf8"),
    }
  } catch (error) {
    return {
      fileName: basename(entry.relativePath),
      path: resolvedPath,
      content: error instanceof Error ? error.message : "Unable to read file.",
    }
  }
}
