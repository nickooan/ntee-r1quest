import React from "react"
import { describe, expect, test } from "@jest/globals"
import { renderToString } from "ink"
import {
  buildHomeConfigInput,
  ConfigGenerator,
} from "../src/views/config-generator/index.tsx"

// Strip ANSI color escapes. The prompt label and the cursor are adjacent Text
// nodes of different colors, so when ink emits color (TTY/FORCE_COLOR) an escape
// sequence lands between them — breaking substring assertions that span the two.
const stripAnsi = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/\u001b\[[0-9;]*m/g, "")

describe("config generator view", () => {
  test("renders collection and ai choices", () => {
    const output = stripAnsi(
      renderToString(
        <ConfigGenerator
          configPath="/home/test/.ntee-r1quest/r1qconfig.yaml"
          onComplete={() => {}}
        />,
      ),
    )

    expect(output).toContain("R1Quest Config Generator")
    expect(output).toContain("instruction: Type a collection path,")
    expect(output).toContain("Press Enter to leave it unset;")
    expect(output).toContain("Press Esc to cancel;")
    expect(output).toContain("Collection path [default: null]: |")
    expect(output).toContain("None")
    expect(output).toContain("Codex")
    expect(output).toContain("Claude")
    expect(output).toContain("Cursor")
  })

  test("builds config values with a default temp-dir socket", () => {
    // Every generated config carries a default `sock` under the OS temp dir,
    // so one-shot runs can hand call records to an open terminal app.
    const sock = expect.stringMatching(/ntee-r1quest\.sock$/)

    expect(buildHomeConfigInput("", 0)).toEqual({
      root: null,
      sock,
    })
    expect(buildHomeConfigInput("~/collections/example", 2)).toEqual({
      root: "~/collections/example",
      ai: "claude",
      sock,
    })
    expect(buildHomeConfigInput("~/collections/example", 3)).toEqual({
      root: "~/collections/example",
      ai: "cursor",
      sock,
    })
  })
})
