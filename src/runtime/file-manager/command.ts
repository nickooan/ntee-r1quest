export const resolveSidebarCommand = (
  inputCommand: string,
  selectedCommand: string,
): string => {
  const trimmedInputCommand = inputCommand.trim()

  if (!trimmedInputCommand || trimmedInputCommand.startsWith("@")) {
    return selectedCommand
  }

  return inputCommand
}

export const resolveParentDirectoryCommand = (
  commandValue: string,
): string | undefined => {
  const normalizedCommand = commandValue.trim().replaceAll("\\", "/")

  if (!normalizedCommand) {
    return undefined
  }

  const pathParts = normalizedCommand.split("/").filter(Boolean)

  if (pathParts.length === 0) {
    return undefined
  }

  pathParts.pop()

  return pathParts.length === 0 ? "" : `${pathParts.join("/")}/`
}
