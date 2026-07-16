# ntee-r1quest

A Postman-like terminal app for running HTTP requests from a **file-based
collection**. Collections are plain text — `.nts` requests and `.ntd` data — so
teams can keep them in Git, generate them from OpenAPI/GraphQL specs, review
changes in pull requests, and run the same request set locally or in CI.

It also pairs with your **local AI coding agent**. In `@ai` mode you talk to
Claude Code, Codex, or Cursor right inside the app: the agent can write and edit
requests, trigger them, and have the responses reflected live in the Result
pane — so you build and debug an API flow together without leaving the terminal.

```bash
npx ntee-r1quest -r ./example/request
```

![ntee-r1quest terminal demo](https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/docs/assets/readme-demo.gif)

### Highlights

- 📁 **Plain-text collections** — `.nts` requests and `.ntd` data you can
  version control and review.
- 🤖 **Collaborate with your local AI agent** — pair with Claude Code, Codex,
  or Cursor in `@ai` mode: reference files with `#name`, keep typing while the
  agent thinks, and watch results land in the Result pane.
- 🔎 **Fuzzy search everywhere** — type any part of a request name and nested
  files pop up from collapsed folders (`gob` finds `get-orders-by-id`).
- 🖥️ **Modal terminal UI (Go / Bubble Tea)** — run, view, edit, search, and
  browse history without leaving the keyboard.
- 🔁 **Reusable data + environment macros** with defaults: `@i(key or …)`,
  `@env(KEY or …)`, plus file uploads via `@f(…)`.
- ⚡ **One-shot execution** (`-p`) for scripts and CI, with env injection
  (`-env`), trace tagging (`-ti`), and joint chain files.
- 🕘 **History & cache** — past request/response pairs grouped by trace, input
  history, and editor autosuggestions.
- 🧩 **GraphQL-friendly**, with an AI plugin (skills) for Claude Code, Codex,
  and Cursor.

## Quick Start

`ntee-r1quest` targets **Node.js 24 or newer** and runs on **macOS and Linux
only** (some features shell out to platform tools; use WSL on Windows).

Run a request collection with `npx`:

```bash
npx ntee-r1quest -r ./example/request
```

Inside the app, type any part of a request name and press Enter — the popup
fuzzy-matches across the whole collection:

```text
@query >example
@query >folder-1/get-post
```

If `-r` is omitted, `ntee-r1quest` looks for `.r1qconfig.yaml`, then falls back
to the current directory as the request root. First-time setup — create the
home config with a short wizard:

```bash
npx ntee-r1quest --init
```

**Install from source** (clones into `~/.ntee-r1quest/source`, builds, and
links the `r1q` / `ntee-r1quest` commands; requires git, Node.js 24+, npm, and
Go 1.24+):

```bash
curl -fsSL https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/install.sh | sh
```

Re-run the same command any time to update in place. Pin a version with
`NTEE_REF=v0.13.3`, or clone from a mirror with `NTEE_REPO=<url>`.

## CLI Reference

```bash
ntee-r1quest [-r <root>] [-ai <adapter>] [-p <request>] [-ti <id>] [-env <json>]
ntee-r1quest --init | --version | --install-claude-plugin
```

| Flag                      | Argument                | Purpose                                                                                                |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `-r`                      | `<root>`                | Request collection root. Falls back to config, then the current directory.                             |
| `-ai`                     | `codex\|claude\|cursor` | AI adapter for `@ai` mode.                                                                             |
| `-p`                      | `<request>`             | Run one request and print the response without opening the UI (`.nts` optional).                       |
| `-ti`                     | `<id>`                  | Tag the run with a trace id so related requests group in history (`@h <id>`). Optional.                |
| `-env`                    | `'{"K":"V"}'`           | Supply `@env(...)` values as JSON, merged over `process.env` (these win). Optional.                    |
| `--init`                  | —                       | Open the home-config wizard, then print the paths created.                                             |
| `--version`               | —                       | Print the installed version and exit.                                                                  |
| `--install-claude-plugin` | —                       | Install the bundled R1Quest plugin into Claude Code via the `claude` CLI (works for npm installs too). |

**One-shot examples**

```bash
# Run a single request
npx ntee-r1quest -r ./example/request -p folder-1/get-post

# Inject env values for @env(...) macros and tag the run with a trace id
r1q -r ./example/request -p users/get -env '{"API_TOKEN":"abc"}' -ti task-42

# Run a joint chain file — steps share one trace id, only the final response prints
r1q -r ./example -p request/queries/query-user-post.joint
```

`-p` also accepts joint chain files (`-ti` overrides the declared trace id,
`-env` seeds the chain env), and a one-shot run can notify an open terminal app
over the `sock` socket — see the
[configuration guide](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/configuration.md).

## The terminal app in 60 seconds

Everything happens in modes, switched by typing a command (inline arguments
work: `@v folder/get`, `@h task-42`) or cycling **Shift+Tab**
(`@query → @history → @ai`):

| Command    | Alias | Purpose                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| `@query`   | `@q`  | Run request files and view responses (the default mode).    |
| `@view`    | `@v`  | Open a request or data file in the Result pane (read-only). |
| `@edit`    | `@e`  | Edit a file in the Result pane.                             |
| `@search`  | `@s`  | Search the current Result or reviewed file content.         |
| `@history` | `@h`  | Browse cached request/response history.                     |
| `@ai`      |       | Open the AI chat.                                           |

In `@query`, type any part of a name — matching is fuzzy across the whole
collection, suggestions show full paths, and Enter runs the pick. The editor
(`@e`) has contextual completions, undo/redo, buffer search, and Ctrl+J/O
jump-to-reference. In `@ai`, reference files with `#name` (they travel to the
agent as real file links), keep typing while the agent thinks — steered into
the live turn on Claude, queued for the next turn on Codex/Cursor — and answer
tool-permission banners with `y`/`n`. Action commands round it out: `@copy`,
`@reload`, `@clean-cache`, `@exit`.

**Full guide — every mode and key:**
[docs/terminal-app.md](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/terminal-app.md)

## Writing requests in 60 seconds

`.ntd` files hold reusable data; `.nts` files declare requests that `ref` them:

```ntd
// data/example.ntd
host: "https://jsonplaceholder.typicode.com"
path: /todos/1
content-type: application/json
token: @env(API_TOKEN or "dev-token")
```

```nts
// get-todo.nts
ref ./data/example.ntd

url "@i(host)@i(path)"
type get

header accept, @i(content-type)
auth bearer @i(token)
```

Macros do the wiring: `@i(key)` reads referenced data (with `or` defaults),
`@env(KEY)` reads environment variables (`.ntd`-only), and `@f(path)` uploads
files in the body. Joint chain files (`@joint()` + `-> @run(...)` /
`-> @pick(...)`) run several requests as one traced flow, feeding picked
response values into later steps. GraphQL fits naturally — keep the operation
and variables in a `.ntd`, the HTTP request in a `.nts`.

**Full reference — grammar, rules, joint chains, macros, GraphQL, examples:**
[docs/writing-requests.md](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/writing-requests.md)

## Config in 60 seconds

`.r1qconfig.yaml` is looked up in the current directory, the request root, and
`~/.ntee-r1quest/`; precedence is
`flags > root config > cwd config > home config`.

```yaml
root: ~/example-api-collection
ai: codex
sock: /tmp/ntee-r1quest.sock
custom-suggestions:
  - x-trace-token
custom-ai-commands:
  - name: for-test
    description: use for testing
    instruction: run $1 then compare with $2
```

`sock` lets one-shot runs hand their results to an open app (which owns the
history store); `custom-ai-commands` become `/name args` prompts in AI mode.

**Full guide — lookup, merging rules, every field, storage (ntee-db):**
[docs/configuration.md](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/configuration.md)

## Documentation

| Guide                                                                                                  | Covers                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [Terminal app](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/terminal-app.md)         | Modes, full key manual, history & cache, AI chat/adapter/debug log |
| [Writing requests](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/writing-requests.md) | `.ntd` / `.nts` grammar, joint chains, macros, GraphQL, examples   |
| [Configuration](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/configuration.md)       | `.r1qconfig.yaml` lookup & merging, `sock`, ntee-db storage        |
| [Development](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/development.md)           | Architecture, building from source, tests, the R1Quest AI plugin   |
| [Release notes](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/releases)               | What changed in each version                                       |

## Development

The UI is a Go / Bubble Tea binary; the TypeScript runtime (parser, cache,
AI/ACP adapters) runs alongside it, speaking JSON-RPC over a Unix socket.
`npm run build` produces the full publishable `dist/`; `npm test` and
`npm run test:tui` run the TypeScript and Go suites. See
[docs/development.md](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/docs/development.md)
for the details and the bundled Claude Code / Codex / Cursor plugin.

## License

See [LICENSE](https://codeberg.org/nickoan/ntee-r1quest/src/branch/main/LICENSE).
