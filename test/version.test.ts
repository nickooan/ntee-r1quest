import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { VERSION } from "../index.ts"

describe("version", () => {
  test("matches package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string }

    expect(VERSION).toBe(packageJson.version)
  })
})
