// Copies non-TS build assets into dist/: the ohm grammars and the Claude plugin
// marketplace. Run as the last step of `build:ts`.
import { mkdir, copyFile, cp, rm } from "node:fs/promises"

await mkdir("dist/src/compiler", { recursive: true })
await copyFile(
  "src/compiler/script-grammar.ohm",
  "dist/src/compiler/script-grammar.ohm",
)
await copyFile(
  "src/compiler/definition-grammar.ohm",
  "dist/src/compiler/definition-grammar.ohm",
)

// Bundle the Claude plugin marketplace into dist so it ships in the npm tarball
// (dist is whitelisted in package.json `files`); `--install-claude-plugin` adds
// the marketplace from this copy. Hidden manifests (.claude-plugin) are kept;
// .DS_Store is skipped.
await rm("dist/skills/r1quest-ai-plugin", { recursive: true, force: true })
await cp("skills/r1quest-ai-plugin", "dist/skills/r1quest-ai-plugin", {
  recursive: true,
  filter: (src) => !src.endsWith(".DS_Store"),
})
