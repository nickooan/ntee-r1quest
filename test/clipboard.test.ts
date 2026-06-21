import { afterEach, describe, expect, test } from "@jest/globals"
import { clipboardCommandsForPlatform } from "../src/runtime/clipboard.ts"

const originalPlatform = process.platform

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })
}

describe("clipboard platform support", () => {
  afterEach(() => {
    setPlatform(originalPlatform)
  })

  test("uses pbcopy on macOS", () => {
    setPlatform("darwin")

    expect(clipboardCommandsForPlatform()).toEqual([
      { command: "pbcopy", args: [] },
    ])
  })

  test("tries Wayland and X11 utilities on Linux", () => {
    setPlatform("linux")

    expect(
      clipboardCommandsForPlatform().map(({ command }) => command),
    ).toEqual(["wl-copy", "xclip", "xsel"])
  })

  test("offers no clipboard utility on unsupported platforms", () => {
    setPlatform("win32")

    expect(clipboardCommandsForPlatform()).toEqual([])
  })
})
