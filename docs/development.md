# Development and tooling

Installing the CLI, how the app is put together, building from source, and the
bundled AI plugin. For day-to-day usage, see the [README](../README.md).

## Local CLI

Install the published package globally:

```bash
npm install -g ntee-r1quest
```

The package name is `ntee-r1quest`, and the CLI command is `r1q`:

```bash
r1q -r ./example/request
r1q -r ./example/request -ai claude
```

## How it runs

The terminal UI is a **Go / Bubble Tea** binary; the **TypeScript runtime**
(parser, cache, AI/ACP adapters) runs as a separate process and the two speak
JSON-RPC over a per-run Unix-domain socket. The `r1q` entry point handles
one-shot flags (`--version`, `--init`, `-p`, `--install-claude-plugin`) in
TypeScript, then launches the Go binary for the interactive session. The Go
binary is the only interactive UI; on a platform it isn't built for, use
one-shot mode (`-p`) — there is no fallback UI.

## Building from source

```bash
npm install
npm run build           # TypeScript runtime + cross-compiled Go binaries → dist/
npm link
r1q -r ./example/request
```

Build scripts:

| Script              | Builds                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `npm run build:ts`  | TypeScript runtime + assets → `dist/` (no Go binary).              |
| `npm run build:tui` | Cross-compiled `dist/bin/r1q-tui-<os>-<arch>` for each platform.   |
| `npm run build`     | `build:ts` + `build:tui` (the full publishable `dist/`).           |
| `npm run start:go`  | Build everything and run the Go UI against the example collection. |

Building the Go binaries requires the Go toolchain (1.24+); macOS and Linux on
`amd64`/`arm64` are shipped. Run the test suites with `npm test` (TypeScript),
`npm run test:tui` (Go), and `npm run test:tui-int` (cross-language socket
integration).

There is also a curl installer that clones, builds, and links from source —
see the [README Quick Start](../README.md#quick-start).

## R1Quest AI Plugin

This repo includes a local Claude Code marketplace containing the R1Quest AI
plugin. The plugin provides skills for generating, understanding, running, and
editing `ntee-r1quest` projects.

Available skills:

- `openapi-r1quest-generator`: Generate request projects from Swagger/OpenAPI
  v3 YAML or JSON files.
- `r1quest-language-runtime`: Understand `.ntd` and `.nts` syntax, macros
  (including `or` defaults), request keywords, config behavior, and one-shot
  `-p` / `-env` / `-ti` execution.
- `r1quest-one-shot-runner`: Locate and run named requests — a single request,
  or an ordered task where earlier responses feed later ones via `-env` and a
  shared `-ti` trace id.
- `r1quest-project-editor`: Scan and safely update an existing request root.
- `r1quest-graphql-generator`: Generate GraphQL query and mutation examples.
- `graphql-schema-r1quest-generator`: Generate a GraphQL request project from a
  GraphQL schema or introspection JSON file.

The Claude plugin uses a marketplace root with the plugin stored under
`plugin/`:

```text
skills/r1quest-ai-plugin/             # marketplace root
  .claude-plugin/
    marketplace.json
  plugin/
    .claude-plugin/
      plugin.json
    skills/
      openapi-r1quest-generator/
      r1quest-language-runtime/
      r1quest-one-shot-runner/
      r1quest-project-editor/
      r1quest-graphql-generator/
      graphql-schema-r1quest-generator/
```

The plugin marketplace is bundled with the package (under `dist/`), so the
simplest install is:

```bash
r1q --install-claude-plugin
```

This registers the bundled marketplace and installs the plugin into Claude
Code via the `claude` CLI (Claude Code must be installed). Equivalently, add
the marketplace and install it by hand from a source checkout:

```bash
/plugin marketplace add ./skills/r1quest-ai-plugin
/plugin install r1quest-ai-plugin@r1quest-ai
```

The installed skills appear under the plugin namespace.

To use individual skills with Codex, import them from the plugin's `skills`
directory:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/r1quest-ai-plugin/plugin/skills/* "${CODEX_HOME:-$HOME/.codex}/skills/"
```

To use individual skills with Cursor CLI — globally, or only for the current
project:

```bash
mkdir -p ~/.cursor/skills
cp -R skills/r1quest-ai-plugin/plugin/skills/* ~/.cursor/skills/

# project-local
mkdir -p .cursor/skills
cp -R skills/r1quest-ai-plugin/plugin/skills/* .cursor/skills/
```

Once installed, ask Claude Code, Codex, or Cursor to generate requests from
OpenAPI, generate requests from a GraphQL schema, explain `.ntd`/`.nts`
syntax, run one-shot `-p` requests, or update files in an existing request
root.
