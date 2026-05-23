export { resolveSidebarCommand } from "./command.ts"
export { formatFileTreeEntryLabel, formatFileTreeEntryParts } from "./format.ts"
export { isInsideRoot } from "./path.ts"
export {
  buildExpandedDirectoryPaths,
  buildFileTreeEntries,
  buildFileTreeViewport,
  findFileTreeMatchIndex,
  resolveHighlightedEntry,
} from "./tree.ts"
export type { FileTreeEntry, OpenViewFile } from "./types.ts"
export { readViewFile } from "./view-file.ts"
