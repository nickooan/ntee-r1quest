import React from "react"
import { describe, expect, test } from "@jest/globals"
import { renderToString } from "ink"
import {
  buildHomeConfigInput,
  ConfigGenerator,
} from "../src/views/config-generator/index.tsx"

describe("config generator view", () => {
  test("renders collection and ai choices", () => {
    const output = renderToString(
      <ConfigGenerator
        configPath="/home/test/.ntee-r1quest/r1qconfig.yaml"
        onComplete={() => {}}
      />,
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

  test("builds config values with no defaults selected", () => {
    expect(buildHomeConfigInput("", 0)).toEqual({
      root: null,
    })
    expect(buildHomeConfigInput("~/collections/example", 2)).toEqual({
      root: "~/collections/example",
      ai: "claude",
    })
    expect(buildHomeConfigInput("~/collections/example", 3)).toEqual({
      root: "~/collections/example",
      ai: "cursor",
    })
  })
})
