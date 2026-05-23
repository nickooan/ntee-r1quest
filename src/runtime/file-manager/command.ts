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
