import { relative, sep } from "node:path"

export const isInsideRoot = (root: string, target: string): boolean => {
  const relativeTarget = relative(root, target)

  return (
    relativeTarget === "" ||
    (!relativeTarget.startsWith("..") && !relativeTarget.startsWith(sep))
  )
}
