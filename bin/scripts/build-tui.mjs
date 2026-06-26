// Cross-compiles the Go / Bubble Tea TUI for the supported platforms into
// dist/bin/, so the binaries ship inside the npm package (dist is in `files`).
// The TS entry point (index.ts launchGoTui) selects dist/bin/r1q-tui-<os>-<arch>
// at runtime by process.platform/arch.
//
// Scope: macOS + Linux, amd64 + arm64. Other platforms fall back to the Ink TUI.
// Requires the Go toolchain; publishing the Go-default TUI needs it present.
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const tuiDir = join(repoRoot, "tui")
const outDir = join(repoRoot, "dist", "bin")

const targets = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "amd64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "amd64" },
]

mkdirSync(outDir, { recursive: true })

for (const { os, arch } of targets) {
  const output = join(outDir, `r1q-tui-${os}-${arch}`)
  const result = spawnSync(
    "go",
    ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "./cmd/r1q-tui"],
    {
      cwd: tuiDir,
      stdio: "inherit",
      // CGO off → static, portable binaries (no libc linkage needed).
      env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: "0" },
    },
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
}
