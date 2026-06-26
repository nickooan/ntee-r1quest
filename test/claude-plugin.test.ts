import { describe, expect, jest, test } from "@jest/globals"

// Capture the claude CLI invocations instead of running the real binary.
const spawnCalls: { command: string; args: string[] }[] = []

jest.unstable_mockModule("node:child_process", () => ({
  spawnSync: (command: string, args: string[]) => {
    spawnCalls.push({ command, args })
    return { status: 0, stdout: "ok", stderr: "", error: undefined }
  },
}))

const {
  installClaudePlugin,
  isPluginBundled,
  formatInstallClaudePluginResult,
} = await import("../src/runtime/claude-plugin.ts")
const { parseArguments } = await import("../src/runtime/config.ts")

describe("claude plugin install", () => {
  test("parses the --install-claude-plugin flag", () => {
    expect(parseArguments(["--install-claude-plugin"])).toEqual({
      installClaudePlugin: true,
    })
  })

  test("detects the bundled plugin marketplace", () => {
    expect(isPluginBundled()).toBe(true)
  })

  test("registers the marketplace and installs the plugin via the claude CLI", () => {
    spawnCalls.length = 0

    const result = installClaudePlugin()

    expect(result).toEqual({ ok: true, plugin: "r1quest-ai-plugin@r1quest-ai" })
    expect(spawnCalls.map((call) => call.args)).toEqual([
      [
        "plugin",
        "marketplace",
        "add",
        expect.stringContaining("r1quest-ai-plugin"),
      ],
      ["plugin", "install", "r1quest-ai-plugin@r1quest-ai"],
    ])
    expect(spawnCalls.every((call) => call.command === "claude")).toBe(true)
  })

  test("formats a successful install", () => {
    expect(
      formatInstallClaudePluginResult({
        ok: true,
        plugin: "r1quest-ai-plugin@r1quest-ai",
      }),
    ).toContain("Installed r1quest-ai-plugin@r1quest-ai into Claude Code")
  })

  test("explains when the claude CLI is missing", () => {
    expect(
      formatInstallClaudePluginResult({ ok: false, reason: "no-claude-cli" }),
    ).toContain("Claude Code CLI ('claude') was not found")
  })

  test("surfaces a failed claude command", () => {
    expect(
      formatInstallClaudePluginResult({
        ok: false,
        reason: "command-failed",
        command: "claude plugin install",
        output: "boom",
      }),
    ).toContain("'claude plugin install' failed")
  })

  test("explains a missing bundled plugin without pointing to git", () => {
    const message = formatInstallClaudePluginResult({
      ok: false,
      reason: "missing-plugin",
      path: "/some/dist/skills/r1quest-ai-plugin/.claude-plugin/marketplace.json",
    })

    expect(message).toContain("was not found")
    expect(message).toContain("reinstall ntee-r1quest")
    expect(message).not.toContain("codeberg.org")
  })
})
