import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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

// The plugin marketplace is copied into dist during the build (see
// bin/scripts/copy-assets.mjs) so it ships in the npm tarball (dist is
// whitelisted in `files`). Prefer that copy; fall back to the source `skills/`
// tree for a checkout that hasn't been built yet. The manifest's presence marks
// a usable install and gives `claude` a local source to add.
const manifestPath = (dir: string): string =>
  join(dir, ".claude-plugin", "marketplace.json")

const distMarketplaceDir = join(
  packageRoot,
  "dist",
  "skills",
  "r1quest-ai-plugin",
)
const sourceMarketplaceDir = join(packageRoot, "skills", "r1quest-ai-plugin")

const marketplaceDir = existsSync(manifestPath(distMarketplaceDir))
  ? distMarketplaceDir
  : sourceMarketplaceDir
const marketplaceManifest = manifestPath(marketplaceDir)

/** True when the plugin marketplace is bundled with this install. */
export const isPluginBundled = (): boolean => existsSync(marketplaceManifest)

export type InstallClaudePluginResult =
  | { ok: true; plugin: string }
  | { ok: false; reason: "missing-plugin"; path: string }
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
 * bundled marketplace, then installs the plugin from it. The marketplace is
 * bundled in dist for every install, so this normally always has something to
 * add; a missing bundle indicates an incomplete/corrupt install.
 */
export const installClaudePlugin = (): InstallClaudePluginResult => {
  if (!isPluginBundled()) {
    return { ok: false, reason: "missing-plugin", path: marketplaceManifest }
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
    "The bundled R1Quest Claude plugin was not found at:\n" +
    `  ${result.path}\n` +
    "This install looks incomplete — reinstall ntee-r1quest and try again.\n"
  )
}
