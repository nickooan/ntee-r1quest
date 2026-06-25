import { describe, expect, test } from "@jest/globals"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// Enforces the plan §3.1 invariant: the TS runtime is read-only on the request
// root — it executes requests, it never writes `.nts`/`.ntd` files. Go is the
// sole writer (edit-mode save lives in the Go TUI; there is no write-file RPC).
//
// This is a static guard: nothing under src/runtime/ or src/compiler/ may call a
// file-content write API, except a small allowlist of files that write only
// their OWN infrastructure (never the request root). A new write outside the
// allowlist fails this test, forcing a conscious decision (justify + allowlist,
// or keep the write on the Go side).

const SCAN_ROOTS = ["src/runtime", "src/compiler"]

const WRITE_APIS = [
  "writeFileSync",
  "writeFile",
  "appendFileSync",
  "appendFile",
  "createWriteStream",
  "writeSync",
  "truncateSync",
  "ftruncateSync",
]

// Files permitted to write — to their own infrastructure only, never request
// files. Keep this list tiny and justified.
const ALLOWLIST = new Map<string, string>([
  ["src/runtime/config.ts", "writes the home .r1qconfig.yaml during --init"],
  ["src/runtime/acp/acp-debug.ts", "appends to the ACP debug log"],
])

const collectTsFiles = (dir: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)

    if (statSync(path).isDirectory()) {
      files.push(...collectTsFiles(path))
      continue
    }

    if (
      (path.endsWith(".ts") || path.endsWith(".tsx")) &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test.tsx")
    ) {
      files.push(path)
    }
  }

  return files
}

const writeApisUsedBy = (path: string): string[] => {
  const source = readFileSync(path, "utf8")

  return WRITE_APIS.filter((api) =>
    // Match a call site (`api(`), not an import or a comment mention.
    new RegExp(`\\b${api}\\s*\\(`).test(source),
  )
}

const toRelative = (path: string): string => relative(".", path).split(sep).join("/")

describe("runtime is read-only on the request root (plan §3.1)", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root))

  test("scans a non-trivial number of runtime/compiler files", () => {
    // Guards against a broken scan passing vacuously.
    expect(files.length).toBeGreaterThan(10)
  })

  test("the allowlist scanner actually detects writes (config.ts writes)", () => {
    expect(writeApisUsedBy("src/runtime/config.ts").length).toBeGreaterThan(0)
  })

  test("no file outside the allowlist calls a file-write API", () => {
    const violations: string[] = []

    for (const path of files) {
      const relativePath = toRelative(path)

      if (ALLOWLIST.has(relativePath)) {
        continue
      }

      const used = writeApisUsedBy(path)
      if (used.length > 0) {
        violations.push(`${relativePath}: ${used.join(", ")}`)
      }
    }

    expect(violations).toEqual([])
  })
})
