import { describe, expect, test } from "@jest/globals"
import {
  expandCustomCommandInstruction,
  matchCustomCommands,
  parseCustomCommandInput,
  resolveCustomCommandPrompt,
  type CustomCommand,
} from "../src/runtime/custom-command/index.ts"

const commands: CustomCommand[] = [
  {
    name: "for-test",
    description: "use for testing",
    instruction: "asdgasdfasd $1 asdgasdfasgd $2 asdgasdfg $3",
  },
  {
    name: "format",
    description: "format helper",
    instruction: "format $1",
  },
]

describe("custom commands", () => {
  test("parses a slash command name and positional args", () => {
    expect(parseCustomCommandInput("/for-test one two three")).toEqual({
      name: "for-test",
      args: ["one", "two", "three"],
    })
    expect(parseCustomCommandInput("/for-test")).toEqual({
      name: "for-test",
      args: [],
    })
    expect(parseCustomCommandInput("not a command")).toBeNull()
    expect(parseCustomCommandInput("/")).toBeNull()
  })

  test("substitutes positional placeholders, blanking missing args", () => {
    expect(
      expandCustomCommandInstruction(
        "asdgasdfasd $1 asdgasdfasgd $2 asdgasdfg $3",
        ["one", "two", "three"],
      ),
    ).toBe("asdgasdfasd one asdgasdfasgd two asdgasdfg three")
    expect(expandCustomCommandInstruction("$1 and $2", ["only"])).toBe(
      "only and ",
    )
  })

  test("resolves a typed command into its expanded prompt", () => {
    expect(
      resolveCustomCommandPrompt(commands, "/for-test one two three"),
    ).toBe("asdgasdfasd one asdgasdfasgd two asdgasdfg three")
    expect(resolveCustomCommandPrompt(commands, "/unknown a b")).toBeNull()
    expect(resolveCustomCommandPrompt(commands, "plain message")).toBeNull()
  })

  test("matches commands by name prefix only while typing the name", () => {
    expect(matchCustomCommands(commands, "/for-").map((c) => c.name)).toEqual([
      "for-test",
    ])
    expect(matchCustomCommands(commands, "/f").map((c) => c.name)).toEqual([
      "for-test",
      "format",
    ])
    expect(matchCustomCommands(commands, "/")).toHaveLength(2)
    // Once a space is typed the name is complete: stop suggesting.
    expect(matchCustomCommands(commands, "/for-test ")).toEqual([])
    expect(matchCustomCommands(commands, "plain")).toEqual([])
  })
})
