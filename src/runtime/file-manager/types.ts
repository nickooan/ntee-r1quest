export type FileTreeEntry = {
  name: string
  relativePath: string
  commandValue: string
  depth: number
  type: "directory" | "request" | "file"
  isExpanded: boolean
}

export type OpenViewFile = {
  fileName: string
  path: string
  content: string
}
