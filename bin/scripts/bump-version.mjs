#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const releaseType = process.argv[2]
const supportedReleaseTypes = new Set(["patch", "minor", "major"])

if (!supportedReleaseTypes.has(releaseType)) {
  console.error(
    "Usage: node ./bin/scripts/bump-version.mjs <patch|minor|major>",
  )
  process.exit(1)
}

const packageJsonPath = resolve("package.json")
const versionPath = resolve("src/runtime/version.ts")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const currentVersion = String(packageJson.version)
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion)

if (!match) {
  console.error(`Cannot bump unsupported package version "${currentVersion}".`)
  process.exit(1)
}

let major = Number(match[1])
let minor = Number(match[2])
let patch = Number(match[3])

if (releaseType === "major") {
  major += 1
  minor = 0
  patch = 0
} else if (releaseType === "minor") {
  minor += 1
  patch = 0
} else {
  patch += 1
}

const nextVersion = `${major}.${minor}.${patch}`

packageJson.version = nextVersion
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

const versionSource = readFileSync(versionPath, "utf8")
const nextVersionSource = versionSource.replace(
  /export const VERSION = ".*"/,
  `export const VERSION = "${nextVersion}"`,
)

if (nextVersionSource === versionSource) {
  console.error(`Cannot find VERSION export in ${versionPath}.`)
  process.exit(1)
}

writeFileSync(versionPath, nextVersionSource)
console.log(`Bumped version from ${currentVersion} to ${nextVersion}.`)
