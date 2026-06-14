export type CustomCommand = {
  name: string
  description: string
  instruction: string
}

export type ParsedCustomCommandInput = {
  name: string
  args: string[]
}

// Custom commands are invoked as `/name arg1 arg2 ...`. The name is the first
// whitespace-delimited token after the leading slash; everything after it is
// split on whitespace into positional args.
export const parseCustomCommandInput = (
  input: string,
): ParsedCustomCommandInput | null => {
  const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)

  if (!match || !match[1]) {
    return null
  }

  const rest = match[2]?.trim() ?? ""

  return {
    name: match[1],
    args: rest ? rest.split(/\s+/) : [],
  }
}

// Substitute positional placeholders ($1, $2, ...) in the instruction with the
// provided args. Placeholders without a matching arg become empty strings.
export const expandCustomCommandInstruction = (
  instruction: string,
  args: string[],
): string => {
  return instruction.replace(/\$(\d+)/g, (_whole, digits: string) => {
    const argIndex = Number.parseInt(digits, 10) - 1

    return args[argIndex] ?? ""
  })
}

export const findCustomCommand = (
  commands: CustomCommand[],
  name: string,
): CustomCommand | undefined => {
  return commands.find((command) => command.name === name)
}

// Resolve a typed `/name args` input into its expanded instruction, or null
// when the input is not a slash command or the name is unknown (in which case
// the caller should treat the text as a plain message).
export const resolveCustomCommandPrompt = (
  commands: CustomCommand[],
  input: string,
): string | null => {
  const parsed = parseCustomCommandInput(input)

  if (!parsed) {
    return null
  }

  const command = findCustomCommand(commands, parsed.name)

  if (!command) {
    return null
  }

  return expandCustomCommandInstruction(command.instruction, parsed.args)
}

// Suggestions are offered only while the user is still typing the command name
// (before the first space), matching by name prefix.
export const matchCustomCommands = (
  commands: CustomCommand[],
  input: string,
): CustomCommand[] => {
  if (!input.startsWith("/")) {
    return []
  }

  const afterSlash = input.slice(1)

  if (/\s/.test(afterSlash)) {
    return []
  }

  const query = afterSlash.toLowerCase()

  return commands.filter((command) =>
    command.name.toLowerCase().startsWith(query),
  )
}
