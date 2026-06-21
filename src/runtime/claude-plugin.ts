import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Where to point users who do not have the plugin source (npm-registry installs).
const REPO_URL = "https://codeberg.org/nickoan/ntee-r1quest"
const INSTALL_SCRIPT_URL =
  "https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/install.sh"

// Names declared in the plugin's manifests (marketplace.json / plugin.json).
const MARKETPLACE_NAME = "r1quest-ai"
const PLUGIN_NAME = "r1quest-ai-plugin"
const PLUGIN_REF = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`

// Walk up from this module to the package root (nearest dir with a package.json).
// Node resolves the bin symlink to its real path, so for a `npm link` / source
// install this lands inside the cloned checkout; for an `npm install` it lands
// in the global node_modules copy.
const findPackageRoot = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url))

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(directory, "package.json"))) {
      return directory
    }

    const parent = dirname(directory)

    if (parent === directory) {
      break
    }

    directory = parent
  }

  return directory
}

const packageRoot = findPackageRoot()

// The plugin marketplace ships only with a source/git checkout — the npm
// tarball's `files` list excludes `skills/` — so the marketplace manifest's
// presence marks a source install and gives `claude` a local source to add.
const marketplaceDir = join(packageRoot, "skills", "r1quest-ai-plugin")
const marketplaceManifest = join(
  marketplaceDir,
  ".claude-plugin",
  "marketplace.json",
)

/** True when running from a source/link install that carries the plugin. */
export const isSourceInstall = (): boolean => existsSync(marketplaceManifest)

export type InstallClaudePluginResult =
  | { ok: true; plugin: string }
  | {
      ok: false
      reason: "not-source"
      repoUrl: string
      installScriptUrl: string
    }
  | { ok: false; reason: "no-claude-cli" }
  | { ok: false; reason: "command-failed"; command: string; output: string }

type ClaudeRun = { ok: boolean; output: string; missing: boolean }

const runClaude = (args: string[]): ClaudeRun => {
  const result = spawnSync("claude", args, { encoding: "utf8" })

  if (
    result.error &&
    (result.error as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    return { ok: false, output: "", missing: true }
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()

  return { ok: result.status === 0, output, missing: false }
}

/**
 * Installs the R1Quest plugin into Claude Code via its CLI: registers the
 * bundled marketplace, then installs the plugin from it. Only works from a
 * source install (which carries the marketplace); npm-registry installs are
 * pointed at the Codeberg source instead.
 */
export const installClaudePlugin = (): InstallClaudePluginResult => {
  if (!isSourceInstall()) {
    return {
      ok: false,
      reason: "not-source",
      repoUrl: REPO_URL,
      installScriptUrl: INSTALL_SCRIPT_URL,
    }
  }

  // Adding the marketplace is idempotent (exits 0 when already registered).
  const add = runClaude(["plugin", "marketplace", "add", marketplaceDir])

  if (add.missing) {
    return { ok: false, reason: "no-claude-cli" }
  }

  if (!add.ok) {
    return {
      ok: false,
      reason: "command-failed",
      command: "claude plugin marketplace add",
      output: add.output,
    }
  }

  const install = runClaude(["plugin", "install", PLUGIN_REF])

  if (install.missing) {
    return { ok: false, reason: "no-claude-cli" }
  }

  if (!install.ok) {
    return {
      ok: false,
      reason: "command-failed",
      command: "claude plugin install",
      output: install.output,
    }
  }

  return { ok: true, plugin: PLUGIN_REF }
}

/** Renders the user-facing message for an install attempt. */
export const formatInstallClaudePluginResult = (
  result: InstallClaudePluginResult,
): string => {
  if (result.ok) {
    return (
      `Installed ${result.plugin} into Claude Code (user scope).\n` +
      "Restart Claude Code to load it.\n"
    )
  }

  if (result.reason === "no-claude-cli") {
    return (
      "Claude Code CLI ('claude') was not found on your PATH.\n" +
      "Install Claude Code first, then re-run: r1q --install-claude-plugin\n"
    )
  }

  if (result.reason === "command-failed") {
    return (
      `'${result.command}' failed:\n` + `${result.output || "(no output)"}\n`
    )
  }

  return (
    "The R1Quest Claude plugin ships with the source, not the npm package, so\n" +
    "this build has nothing to install.\n\n" +
    "Get it from Codeberg and install from source, then re-run this command:\n" +
    `  curl -fsSL ${result.installScriptUrl} | sh\n` +
    "  r1q --install-claude-plugin\n\n" +
    `Or clone it manually: ${result.repoUrl}\n`
  )
}
