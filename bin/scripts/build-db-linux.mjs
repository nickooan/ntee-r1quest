// Builds the nteedb C-shared library (libnteedb.so) for Linux via Docker, into
// ntee-db/ntee-db-js/prebuilds/linux-<arch>/ — the same layout capi/build.sh
// produces for the host platform.
//
// Unlike the TUI (CGO_ENABLED=0, freely cross-compiled), the c-shared build
// needs CGO and a matching C toolchain, so each target is built inside a Linux
// container of that architecture. On Apple Silicon, linux/arm64 runs natively
// and linux/amd64 runs under QEMU/Rosetta emulation (slower but correct) —
// enable "Use Rosetta for x86/amd64 emulation" in Docker Desktop for speed.
//
// Only ntee-db/ is mounted (the module is stdlib-only, no downloads needed); a
// named volume caches Go's build cache across runs.
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const dbDir = join(repoRoot, "ntee-db")

// Match ntee-db/go.mod's directive; bookworm ships the gcc the cgo build needs.
const GO_IMAGE = "golang:1.24-bookworm"

const targets = ["linux/arm64", "linux/amd64"]

for (const platform of targets) {
  process.stdout.write(`\nBuilding libnteedb.so for ${platform} ...\n`)
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      platform,
      "-v",
      `${dbDir}:/src`,
      "-v",
      `nteedb-go-build-cache:/root/.cache/go-build`,
      "-w",
      "/src/capi",
      GO_IMAGE,
      "bash",
      "build.sh",
    ],
    { stdio: "inherit" },
  )

  if (result.error) {
    if (result.error.code === "ENOENT") {
      process.stderr.write(
        "build-db-linux: 'docker' was not found on PATH — install/start Docker Desktop.\n",
      )
    } else {
      process.stderr.write(`build-db-linux: ${result.error.message}\n`)
    }
    process.exit(1)
  }
  if (result.status !== 0) {
    process.stderr.write(
      `build-db-linux: build for ${platform} failed (is the Docker daemon running?)\n`,
    )
    process.exit(result.status ?? 1)
  }
}

process.stdout.write(
  "\nAll Linux prebuilds written to ntee-db/ntee-db-js/prebuilds/\n",
)
