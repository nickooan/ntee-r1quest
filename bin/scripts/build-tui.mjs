// Builds the Go / Bubble Tea TUI binary into bin/r1q-tui.
// Requires the Go toolchain. Part of the Phase E cutover groundwork: the Go TUI
// is an opt-in front-end today (`npm run start:go`); flipping it to the default
// `r1q` bin is gated on the remaining parity items (see docs/go-tui-migration-plan.md).
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const tuiDir = join(repoRoot, "tui")
const output = join(repoRoot, "bin", "r1q-tui")

const result = spawnSync(
  "go",
  ["build", "-o", output, "./cmd/r1q-tui"],
  { cwd: tuiDir, stdio: "inherit" },
)

if (result.error) {
  if (result.error.code === "ENOENT") {
    process.stderr.write(
      "build-tui: the Go toolchain ('go') was not found on PATH.\n",
    )
  } else {
    process.stderr.write(`build-tui: ${result.error.message}\n`)
  }
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

process.stdout.write(`Built ${output}\n`)
