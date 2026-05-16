import { mkdir, copyFile } from "node:fs/promises"

await mkdir("dist/src/compiler", { recursive: true })
await copyFile(
  "src/compiler/script-grammar.ohm",
  "dist/src/compiler/script-grammar.ohm",
)
await copyFile(
  "src/compiler/definition-grammar.ohm",
  "dist/src/compiler/definition-grammar.ohm",
)
