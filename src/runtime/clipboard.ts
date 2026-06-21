import { spawn } from "node:child_process"

type ClipboardCommand = { command: string; args: string[] }

// Clipboard helpers per platform. macOS ships `pbcopy`; Linux has no single
// standard, so we try the common Wayland/X11 utilities in order and use the
// first one that is installed and exits cleanly.
export const clipboardCommandsForPlatform = (): ClipboardCommand[] => {
  if (process.platform === "darwin") {
    return [{ command: "pbcopy", args: [] }]
  }

  if (process.platform === "linux") {
    return [
      { command: "wl-copy", args: [] },
      { command: "xclip", args: ["-selection", "clipboard"] },
      { command: "xsel", args: ["--clipboard", "--input"] },
    ]
  }

  return []
}

// Writes `text` to one clipboard utility. Resolves true only when the process
// is spawned and exits with code 0; a missing binary (ENOENT) or non-zero exit
// resolves false so the caller can fall through to the next candidate.
const writeToClipboardCommand = (
  { command, args }: ClipboardCommand,
  text: string,
): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(command, args)
    let settled = false

    const settle = (success: boolean) => {
      if (!settled) {
        settled = true
        resolve(success)
      }
    }

    child.on("error", () => settle(false))
    child.on("close", (code) => settle(code === 0))

    if (child.stdin) {
      child.stdin.on("error", () => settle(false))
      child.stdin.end(text)
    } else {
      settle(false)
    }
  })

/**
 * Copies `text` to the system clipboard on macOS and Linux. Returns true when a
 * clipboard utility accepted the text, false on unsupported platforms or when no
 * utility is available, so callers can decide whether to confirm to the user.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  for (const clipboardCommand of clipboardCommandsForPlatform()) {
    if (await writeToClipboardCommand(clipboardCommand, text)) {
      return true
    }
  }

  return false
}
