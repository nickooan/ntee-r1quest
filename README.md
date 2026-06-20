# ntee-r1quest

A Postman-like terminal app for running HTTP requests from a **file-based
collection**. Collections are plain text, so teams can keep them in Git,
generate them from OpenAPI/GraphQL specs, review changes in pull requests, and
run the same request set locally or in CI.

```bash
npx ntee-r1quest -r ./example/request
```

![ntee-r1quest terminal demo](https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/docs/assets/readme-demo.gif)

### Highlights

- 📁 **Plain-text collections** — `.nts` requests and `.ntd` data you can version
  control and review.
- 🖥️ **Modal terminal UI** — run, view, edit, search, browse history, and chat
  with a local AI agent.
- 🔁 **Reusable data + environment macros**, now with defaults: `@i(key or …)`,
  `@env(KEY or …)`, plus file uploads via `@f(…)`.
- ⚡ **One-shot execution** (`-p`) for scripts and CI, with env injection
  (`-env`) and trace tagging (`-ti`).
- 🕘 **History & cache** — browse past request/response pairs (grouped by trace),
  with input history and editor autosuggestions.
- 🤖 **GraphQL-friendly**, with an AI plugin (skills) for Claude Code, Codex, and
  Cursor.

## Index

**Getting started**

- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)

**Using the app**

- [Terminal Modes](#terminal-modes)
- [Key Manual](#key-manual)
- [Request History and Cache](#request-history-and-cache)
- [AI Adapter](#ai-adapter)
- [AI Debug Log](#ai-debug-log)
- [Config](#config)

**Writing requests**

- [Collection Structure](#collection-structure)
- [`.ntd` Definition Files](#ntd-definition-files)
- [`.nts` Request Files](#nts-request-files)
- [Macros](#macros)
- [Examples](#examples)
- [GraphQL Requests](#graphql-requests)

**Development & tooling**

- [Local CLI and Development](#local-cli-and-development)
- [R1Quest AI Plugin](#r1quest-ai-plugin)

## Quick Start

`ntee-r1quest` targets **Node.js 24 or newer** (`node --version`).

Run a request collection with `npx`:

```bash
npx ntee-r1quest -r ./example/request
```

Inside the app, type a request path (without `.nts`) and press Enter — nested
paths work too:

```text
@query >example
@query >folder-1/get-post
```

If `-r` is omitted, `ntee-r1quest` looks for `.r1qconfig.yaml`, then falls back
to the current directory as the request root.

First-time setup — create the home config with a short wizard (when
`~/.ntee-r1quest/r1qconfig.yaml` is missing):

```bash
npx ntee-r1quest --init
```

## CLI Reference

```bash
ntee-r1quest [-r <root>] [-ai <adapter>] [-p <request>] [-ti <id>] [-env <json>]
ntee-r1quest --init | --version
```

| Flag        | Argument                | Purpose                                                                                 |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `-r`        | `<root>`                | Request collection root. Falls back to config, then the current directory.              |
| `-ai`       | `codex\|claude\|cursor` | AI adapter for `@ai` mode.                                                              |
| `-p`        | `<request>`             | Run one request and print the response without opening the UI (`.nts` optional).        |
| `-ti`       | `<id>`                  | Tag the run with a trace id so related requests group in history (`@h <id>`). Optional. |
| `-env`      | `'{"K":"V"}'`           | Supply `@env(...)` values as JSON, merged over `process.env` (these win). Optional.     |
| `--init`    | —                       | Open the home-config wizard, then print the paths created.                              |
| `--version` | —                       | Print the installed version and exit.                                                   |

**One-shot examples**

```bash
# Run a single request
npx ntee-r1quest -r ./example/request -p folder-1/get-post

# Inject env values for @env(...) macros and tag the run with a trace id
r1q -r ./example/request -p users/get -env '{"API_TOKEN":"abc"}' -ti task-42
```

A one-shot run can also notify an open terminal app — see [`sock`](#config).

## Terminal Modes

The prompt shows the current mode:

```text
@query >
@view >
@edit >
@search >
@history >
@ai >
```

Switch modes by typing a mode command and pressing Enter:

| Command    | Alias | Purpose                                             |
| ---------- | ----- | --------------------------------------------------- |
| `@query`   | `@q`  | Run request files and view responses.               |
| `@view`    | `@v`  | Review request or data files in the Result pane.    |
| `@edit`    | `@e`  | Edit the currently reviewed file.                   |
| `@search`  | `@s`  | Search the current Result or reviewed file content. |
| `@history` | `@h`  | Browse cached request/response history.             |
| `@ai`      | `@a`  | Open the AI chat overlay.                           |

Action commands run a task instead of switching modes:

| Command        | Alias   | Action                                          |
| -------------- | ------- | ----------------------------------------------- |
| `@reload`      |         | Reload config and restart the terminal runtime. |
| `@clean-cache` | `@cc`   | Clear input history and request history.        |
| `@exit`        | `@quit` | Exit the app.                                   |

You can also press Shift+Tab to cycle the three main modes:

```text
@query -> @view -> @ai -> @query
```

When the cycle enters `@ai`, the AI overlay opens; when it cycles out, the
overlay closes and the AI session stays available.

`@search` and `@history` are not part of the Shift+Tab cycle. Enter them
explicitly (`@s` / `@h`), and press Esc — or type another `@` mode command — to
leave.

## Key Manual

### Global

| Key              | Action                                          |
| ---------------- | ----------------------------------------------- |
| Shift+Tab        | Quick-switch through query, view, and AI modes. |
| Enter            | Submit the current mode input or selected item. |
| `@reload`        | Reload config and restart the terminal runtime. |
| `@exit`, `@quit` | Exit the app safely.                            |

### Query Mode

Use `@query` to run request files.

| Key                      | Action                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Type a request path      | Select a request by path without `.nts`.                                                        |
| Enter                    | Run the typed or highlighted request. Pressing Enter again reruns the same highlighted request. |
| Shift+Up / Shift+Down    | Move the sidebar highlight.                                                                     |
| Esc                      | Move to the parent directory selection when possible.                                           |
| Up / Down                | Scroll the Result pane vertically.                                                              |
| Left / Right             | Scroll the Result pane horizontally.                                                            |
| PageUp / PageDown        | Scroll the Result pane by one page.                                                             |
| Home / End               | Jump to the start or end of Result content.                                                     |
| Shift+Left / Shift+Right | Move the input cursor.                                                                          |

### View Mode

Use `@view` to open request and data files in the Result pane.

| Key                      | Action                                                    |
| ------------------------ | --------------------------------------------------------- |
| Type a file path         | Select a file or directory by path.                       |
| Enter                    | Open the selected file, or expand/select a directory.     |
| Shift+Up / Shift+Down    | Move the sidebar highlight.                               |
| Esc                      | Move to the parent directory, or close the reviewed file. |
| Up / Down                | Scroll the reviewed file vertically.                      |
| Left / Right             | Scroll the reviewed file horizontally.                    |
| PageUp / PageDown        | Scroll the reviewed file by one page.                     |
| Shift+Left / Shift+Right | Move the input cursor.                                    |
| Ctrl+E                   | Enter edit mode for the currently reviewed file.          |

### Edit Mode

Use `@edit` while reviewing a file to edit it directly in the Result pane.

| Key                      | Action                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| Type text                | Buffer text at the edit cursor.                                     |
| Enter                    | Insert buffered text, split a line, or accept an active suggestion. |
| Esc                      | Open the save confirmation prompt.                                  |
| Shift + Arrows           | Move the file cursor through the content (works in any state).      |
| Up / Down / Left / Right | Move the file cursor — **only when no text is buffered**.           |
| Left / Right             | Move within buffered text — while you have uncommitted input.       |
| Backspace / Delete       | Delete buffered text, or delete file content before the cursor.     |
| Ctrl+S                   | Save immediately and return to view mode.                           |
| Ctrl+A                   | Move the current token into the input bar for inline editing.       |

> **Why Shift?** While you have uncommitted typed text, plain Up/Down are
> ignored and plain Left/Right move within that text — so an accidentally pressed
> arrow can't jump the file cursor and abandon what you were typing. Hold Shift
> to move the file cursor. With nothing buffered, plain arrows navigate normally.

Editor suggestions appear while typing request keywords, macros, definition
keys, or `ref` paths.

| Key       | Action                                                         |
| --------- | -------------------------------------------------------------- |
| Up / Down | Move the highlighted suggestion while the dropdown is visible. |
| Tab       | Apply the highlighted suggestion.                              |
| Enter     | Apply the highlighted suggestion.                              |

Examples:

- `hea` suggests `header`.
- `header cont` suggests headers such as `content-type` and inserts the
  trailing `, `.
- `@` suggests macros such as `@i`, `@f`, `@env`, and concrete `@i(key)` values
  from referenced `.ntd` files.
- `@i(` suggests referenced `.ntd` keys.
- `ref ../d` suggests matching directories and `.ntd` files, such as
  `../data/` or `../default.ntd`.

### Search Mode

Use `@search` (or `@s`) to search the current response or reviewed file. You can
pass the query inline to search immediately, for example `@s uuid` or
`@search order id` — the text after the command name becomes the query.

| Key                      | Action                                      |
| ------------------------ | ------------------------------------------- |
| Type a search query      | Prepare a search query.                     |
| Enter                    | Apply the query and highlight matches.      |
| Esc                      | Return to the mode you entered search from. |
| Up / Down                | Move between matches.                       |
| Left / Right             | Scroll horizontally.                        |
| PageUp / PageDown        | Scroll vertically by one page.              |
| Home / End               | Jump to the first or last match.            |
| Shift+Left / Shift+Right | Move the search input cursor.               |

When a query has no matches, a "Nothing found" overlay appears; press Enter to
dismiss it.

If you enter `@edit` from search while reviewing a file, editing starts near the
focused match.

### History Mode

Use `@history` (or `@h`) to browse previously run requests. The left pane lists
cached endpoints; the right pane shows the formatted request/response for the
selected one, with its duration in the header. See
[Request History and Cache](#request-history-and-cache) for what gets recorded.

Pass a trace id inline to view only that trace's calls: `@h <traceId>` (bare
`@h` / `@history` shows all endpoints).

| Key                   | Action                                                    |
| --------------------- | --------------------------------------------------------- |
| Type to filter        | Filter the endpoint list; an overlay shows matches.       |
| Up / Down             | Move through the filter overlay (while it is open).       |
| Enter                 | Select the highlighted endpoint.                          |
| Shift+Up / Shift+Down | Move the endpoint highlight (overlay closed).             |
| Up / Down             | Scroll the Result pane vertically (overlay closed).       |
| Left / Right          | Scroll the Result pane horizontally.                      |
| `@h <traceId>`        | Show only the calls recorded under `<traceId>`, in order. |

### AI Mode

Use `@ai` to chat with a local terminal AI agent through an ACP adapter.

| Key           | Action                                        |
| ------------- | --------------------------------------------- |
| Type a prompt | Compose an AI prompt.                         |
| Enter         | Send the prompt.                              |
| Esc           | Hide the AI overlay and return to query mode. |
| Up / Down     | Scroll AI messages.                           |
| Left / Right  | Move the AI input cursor.                     |
| `y` / `n`     | Respond to permission prompts when shown.     |

The AI session can keep running while you leave and re-enter the overlay.

#### Custom AI commands

Define reusable prompts as `custom-ai-commands` in `.r1qconfig.yaml` (see
[Config](#config)) and invoke them in AI mode by typing `/` followed by the
command name and arguments:

```text
/for-test one two three
```

Arguments are positional: `$1`, `$2`, `$3`, ... in the command's `instruction`
are replaced with the words after the command name. The example above expands an
`instruction` of `asdgasdfasd $1 asdgasdfasgd $2 asdgasdfg $3` into
`asdgasdfasd one asdgasdfasgd two asdgasdfg three`, and that expanded text is
both shown in the chat and sent to the AI. Placeholders without a matching
argument expand to an empty string, and an unknown `/command` is sent as-is.

As you type `/`, a suggestion popup lists commands whose name matches what you
have typed so far. Custom commands work only in AI mode.

| Key       | Action                                                      |
| --------- | ----------------------------------------------------------- |
| Up / Down | Move the highlighted command while the popup is visible.    |
| Tab       | Accept the highlighted command (inserts `/name ` for args). |
| Enter     | Accept the highlighted command while the popup is visible.  |

## Request History and Cache

`ntee-r1quest` keeps a small local cache under `~/.ntee-r1quest/cache/` so your
inputs and successful calls persist across sessions. Writes are best-effort and
never block the app; `@`-mode commands are never cached.

**Input suggestions.** As you type a path in `@query` or `@view`, an overlay
above the command line offers prefix matches — current-directory files and
folders in **yellow**, and previously run inputs from the cache in **green**.

**Request history.** Every successful request is recorded by endpoint
(`/path [method]`, or `Operation [type]` for GraphQL). Browse it in
[History Mode](#history-mode): the latest request/response for each endpoint,
formatted with status and duration. A repeat call to the same endpoint replaces
its previous entry.

**Trace grouping.** Tag one-shot runs with `-ti <id>` (see
[CLI Reference](#cli-reference)) to record them under a shared trace. In History
Mode, `@h <id>` lists just that trace's calls **in the order they ran** — handy
for reviewing a multi-step flow.

**Clearing.** Run `@clean-cache` (or `@cc`) to wipe both input history and
request history.

## AI Adapter

Choose an AI adapter with `-ai`:

```bash
npx ntee-r1quest -r ./example/request -ai codex
```

or:

```bash
npx ntee-r1quest -r ./example/request -ai claude
```

or:

```bash
npx ntee-r1quest -r ./example/request -ai cursor
```

Supported adapters:

- `codex`
- `claude` for Claude Code
- `cursor` for Cursor CLI

The Cursor adapter requires the Cursor CLI `agent` command to be installed and
authenticated. It starts Cursor as an ACP server with `agent acp`.

If `-ai` is not provided, `ntee-r1quest` reads `.r1qconfig.yaml`. If no adapter
is declared, `@ai` shows a configuration error instead of choosing one
implicitly.

### AI Debug Log

For diagnosing AI sessions (for example a "thinking" indicator that seems stuck),
set the `R1QUEST_ACP_DEBUG` environment variable to record the ACP exchange to a
file:

```bash
# Logs to ~/.ntee-r1quest/acp-debug.log
R1QUEST_ACP_DEBUG=1 r1q -r ./example/request -ai claude

# Or write to a specific path
R1QUEST_ACP_DEBUG=/tmp/acp.log r1q -r ./example/request -ai claude
```

Each line is timestamped and records the prompt lifecycle, so you can follow a
turn end to end:

- `prompt_sent` / `prompt_resolved` (with `stopReason`) / `prompt_failed` — the
  turn opening and closing.
- `session_update` — every update the agent streams, with its `kind` and (for
  tool calls) `title` and `status`.
- `permission_requested` / `permission_active` / `permission_resolved` — the
  permission lifecycle.

The log is disabled unless the variable is set, is best-effort, and never affects
the app. Reproduce the issue, then read the file (for example
`tail -f ~/.ntee-r1quest/acp-debug.log`).

## Config

Config lookup checks the current directory first:

```text
./.r1qconfig.yaml
```

When a request root is resolved, its config is also loaded:

```text
<request-root>/.r1qconfig.yaml
```

Then it checks the home config:

```text
~/.ntee-r1quest/r1qconfig.yaml
```

`.r1qconfig.yml` is also accepted. `.r1qconfig.json` is not a valid config file
name.

Example:

```yaml
root: ~/example-api-collection
ai: codex
sock: /tmp/ntee-r1quest.sock
custom-suggestions:
  - some-style-id
  - x-trace-token
custom-ai-commands:
  - name: for-test
    description: use for testing
    instruction: asdgasdfasd $1 asdgasdfasgd $2 asdgasdfg $3
```

### How config sources combine

Up to three config files are read and combined: the request-root directory's
config, the current directory's config, and the home config. They are not
deep-merged — each setting is resolved with this precedence (highest first):

```text
command-line flags  >  <request-root>/.r1qconfig.yaml  >  ./.r1qconfig.yaml  >  ~/.ntee-r1quest/r1qconfig.yaml
```

(The `root` value itself is resolved from the current directory and home config
before the request-root config is loaded.)

How each field combines:

- **Scalars** (`root`, `ai`, `sock`) are not merged. The first source that
  defines a non-empty value wins; later sources are ignored. A command-line flag
  (`-r`, `-ai`) always overrides config.
- **`custom-suggestions`** is a **union** of every source, deduplicated. All
  entries from all configs are offered.
- **`custom-ai-commands`** is merged **by command name**, and the first
  occurrence of a name wins. A `for-test` defined in the request-root config
  therefore shadows a `for-test` of the same name in the home config.

### Field reference

`custom-suggestions` adds user-defined editor suggestions for request header
keys and object body keys.

`custom-ai-commands` defines reusable AI prompts invoked with `/name args` in AI
mode. Each entry needs a `name` and an `instruction`; `description` is optional
and shown in the suggestion popup. Positional placeholders (`$1`, `$2`, ...) in
the `instruction` are filled with the arguments typed after the command name.
Entries missing a `name` or `instruction` are skipped. See
[Custom AI commands](#custom-ai-commands).

When `sock` is set, the terminal app listens on that Unix socket for external
request events. A `-p` execution posts its formatted response to the socket when
available, so an open terminal app can highlight the matching request and show
the result.

## Collection Structure

A request collection usually looks like this:

```text
my-requests/
  data/
    common.ntd
    auth.ntd
  files/
    upload.txt
  get-user.nts
  create-user.nts
  folders/
    get-posts.nts
```

- `.nts` files declare executable HTTP requests.
- `.ntd` files hold reusable data loaded by `ref`.
- Other files can be used by `@f(path)` for uploads.

## `.ntd` Definition Files

`.ntd` files hold reusable data. `.nts` files load them with `ref` and read
values with `@i(key)`.

Example:

```ntd
host: "https://jsonplaceholder.typicode.com"
path: /todos/1
content-type: application/json
token: @env(API_TOKEN)
enabled: true
age: 2
tags: ["api", "example"]
profile: {
  name: "r1quest"
}
```

Supported value types:

- string
- number
- boolean
- null
- array
- object
- `@env(KEY)` / `@env(KEY or <default>)` environment variable macro — standalone
  or embedded inside a bare value (e.g. `path: /todos/@env(id or 1)`)

Rules and cautions:

- Wrap URLs in double quotes. Unquoted `http://` or `https://` contains `//`,
  which starts a comment.
- Bare values default to strings unless they are `true`, `false`, `null`, or a
  number.
- Keys may be bare identifiers such as `content-type`, or quoted strings when
  needed.
- `.ntd` files can use `@env(KEY)`, but cannot use `@i(...)` or `@f(...)`.
- `@env(...)` may stand alone as a value **or** be embedded inside a bare
  (unquoted) value, where it resolves and is spliced into the surrounding text,
  e.g. `path: /todos/@env(id or 1)` → `/todos/1`. Embedding works only in bare
  values — inside a quoted string the `@env(...)` text stays literal.
- Comments start with `//`.

Good:

```ntd
host: "https://httpbin.org"
```

Problematic:

```ntd
host: https://httpbin.org
```

## `.nts` Request Files

`.nts` files declare one HTTP request.

Example:

```nts
ref ../data/example.ntd

url "@i(host)@i(path)"
type get

header accept, @i(content-type)
header content-type, @i(content-type)
```

Supported declarations:

- `ref ./path/to/file.ntd`
- `url "https://example.com/path"`
- `type get`
- `header content-type, application/json`
- `auth bearer token`
- `authorization basic token`
- `body ...`

References must appear before other request statements:

```nts
ref ../data/example.ntd
```

The path is resolved relative to the `.nts` file.

URL:

```nts
url "@i(host)@i(path)"
```

The URL declaration expects a quoted string. You can interpolate `@i(...)`
macros inside the string.

Method:

```nts
type post
```

Common HTTP methods such as `get`, `post`, `put`, `patch`, and `delete` are
supported.

Authorization:

```nts
auth bearer @i(token)
```

or:

```nts
authorization basic @i(credentials)
```

Headers:

```nts
header accept, application/json
header content-type, @i(content-type)
```

Header keys are normalized to lowercase at compile time. Header macro values
must resolve to primitive values: string, number, boolean, or null.

JSON object body:

```nts
body {
  name: "r1quest"
  enabled: true
  tags: ["api", "example"]
}
```

JSON array body:

```nts
body [
  { name: "first" },
  { name: "second" }
]
```

Plain text body:

```nts
body "plain text body"
```

Multiline text body:

```nts
body "line one
line two
line three"
```

Multipart file upload body:

```nts
ref ../data/example-upload.ntd

url "@i(host)/post"
type post

header content-type, @i(content-type)

body {
  name: "r1quest"
  file: @f(../files/example.txt)
}
```

Rules and cautions:

- `ref` paths are resolved relative to the `.nts` file.
- `@env(...)` cannot be used in `.nts` files — it is a compile error
  (`Unsupported macro operator: env`). Read env values in a `.ntd` and reference
  them with `@i(...)`. See [`@env(KEY)`](#envkey).
- `@f(...)` is only valid inside request body values.
- `@f(...)` takes a literal file path, not an `@i(...)` macro.
- File paths in `@f(...)` are resolved relative to the `.nts` file.
- `@f(...)` cannot be used in headers or authorization.
- `@f(...)` cannot be used as the entire body by itself.
- Comments start with `//`.

## Macros

At a glance — which macro is allowed where:

| Macro       | `.ntd` files | `.nts` files          | Defaults (`or`)   |
| ----------- | ------------ | --------------------- | ----------------- |
| `@i(key)`   | ❌ no        | ✅ yes                | ✅ value position |
| `@env(KEY)` | ✅ yes       | ❌ no (compile error) | ✅ value position |
| `@f(path)`  | ❌ no        | ✅ body values only   | —                 |

`or` defaults apply in **value position** (body, header, auth, `.ntd` values),
not inside quoted strings — there, only plain `@i(key)` interpolates.

### `@i(key)`

Reads a value from referenced `.ntd` definition data.

Use it in `.nts` files:

- quoted URL strings
- authorization credentials
- header values
- body values
- plain text/bare string interpolation

Example:

```ntd
host: "https://httpbin.org"
path: /post
content-type: application/json
```

```nts
ref ../data/example.ntd

url "@i(host)@i(path)"
type post

header content-type, @i(content-type)
```

`@i(...)` is not supported inside `.ntd` files.

**Defaults.** Use `@i(key or <value>)` to fall back when the key is missing from
the referenced `.ntd` files. The default must be an immediate string, number, or
boolean — never another macro:

```nts
header accept, @i(accept or "application/json")

body {
  age: @i(age or 20)
  deleted: @i(deleted or true)
}
```

Defaults apply in **value position** (headers, auth, body). They do **not** apply
inside a quoted string — including the `url` value — where only plain `@i(key)`
interpolates. Put a macro that needs a default in value position, or resolve it
in the `.ntd` (e.g. `id: @env(ID or 1)`) and reference it plainly with `@i(id)`.

### `@env(KEY)`

Reads an environment variable.

Use it only in `.ntd` files:

```ntd
token: @env(API_TOKEN)
```

Then reference it from `.nts` with `@i(...)`:

```nts
ref ../data/auth.ntd

url "https://api.example.com/me"
type get

auth bearer @i(token)
```

> **`@env` is `.ntd`-only.** Writing `@env(...)` anywhere in a `.nts` file — a
> value, a header, or inside a string — is a **compile error**
> (`Unsupported macro operator: env`), not literal text. To use an environment
> variable in a request, define it in a `.ntd` (as above) and read it with
> `@i(...)`.

**Defaults.** Use `@env(KEY or <value>)` to fall back when the variable is unset.
The default must be an immediate string, number, or boolean:

```ntd
port: @env(PORT or 8080)
token: @env(API_TOKEN or "dev-token")
debug: @env(DEBUG or false)
```

If the variable is unset and there is no default, compilation throws an error.
To supply values at run time without exporting them, pass
[`-env`](#cli-reference): `-env '{"API_TOKEN":"abc"}'` (values merge over
`process.env` and win on duplicate keys).

**Embedding in bare values.** `@env(...)` can also appear **inside** a bare
(unquoted) value. It resolves and is spliced into the surrounding text, so you
can build paths and identifiers from environment variables:

```ntd
path: /todos/@env(TODO_ID or 1)
path-between: /todos/@env(TODO_ID or 1)/comments
```

With `TODO_ID` unset these compile to `/todos/1` and `/todos/1/comments`; with
`TODO_ID=42` they become `/todos/42` and `/todos/42/comments`. A standalone
`@env(...)` keeps its native type (e.g. a number default stays a number), while
an embedded one is stringified into the value.

> Embedding works only in **bare** values. Inside a **quoted** string the
> `@env(...)` text is treated as literal characters — `path: "/todos/@env(id)"`
> stores `/todos/@env(id)` verbatim. Likewise a literal `@` that is not a valid
> `@env(...)` macro (e.g. `/users/@me`) is preserved as-is.

### `@f(path)`

Loads a local file as a request body value.

Use it only in `.nts` body values:

```nts
body {
  file: @f(../files/example.txt)
}
```

For form uploads, set the request content type to multipart form data:

```nts
header content-type, multipart/form-data
```

## Examples

Run the bundled examples from this repository:

```bash
npm install
npm run build
npm run start
```

`npm run start` runs the compiled app with `example/request` as the request root.

Try:

```text
@query >example
```

or:

```text
@query >example-upload
```

The repo includes JSONPlaceholder examples:

```text
example/data/example.ntd
example/data/example-1.ntd
example/data/example-2.ntd
example/request/example.nts
example/request/folder-1/create-post.nts
example/request/folder-1/get-post.nts
example/request/folder-2/delete-post.nts
example/request/folder-2/update-post.nts
```

It also includes a multipart upload example using httpbin:

```text
example/data/example-upload.ntd
example/request/example-upload.nts
example/files/example.txt
```

The repo also includes GraphQLZero examples that split GraphQL operation text
and variables into `.ntd` files, then execute them from resolver `.nts` files:

```text
example/graphql/query-post.ntd
example/graphql/query-user.ntd
example/graphql/query-user-posts.ntd
example/graphql/query-album-photos.ntd
example/graphql/mutation-create-post.ntd
example/request/queries/query-post.nts
example/request/queries/query-user.nts
example/request/queries/query-user-posts.nts
example/request/queries/query-album-photos.nts
example/request/mutations/mutation-create-post.nts
```

Try one without opening the terminal UI:

```bash
r1q -r ./example -p request/queries/query-post.nts
```

or run the mutation example:

```bash
r1q -r ./example -p request/mutations/mutation-create-post.nts
```

## GraphQL Requests

GraphQL requests work well when `.ntd` files hold the operation and variables,
while `.nts` files hold the HTTP request.

Query definition:

```ntd
query GetPost($id: ID!) {
  post(id: $id) {
    id
    title
    body
  }
}
variables: {
  id: "1"
}
```

Mutation definition:

```ntd
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    id
    title
  }
}
variables: {
  input: {
    title: "R1Quest GraphQL example"
    body: "Created from a GraphQL mutation example."
  }
}
```

Resolver request:

```nts
ref ../../graphql/query-post.ntd

url "https://graphqlzero.almansi.me/api"
type post

header accept, application/json
header content-type, application/json

body {
  query: @i(query)
  variables: @i(variables)
}
```

For mutations, send the operation with `@i(mutation)`:

```nts
body {
  query: @i(mutation)
  variables: @i(variables)
}
```

`.nts` files may reference multiple `.ntd` files. This is useful when shared
auth, host, or token values already live in another definition file:

```nts
ref ../../data/auth.ntd
ref ../../graphql/query-private-user.ntd

url "https://api.example.com/graphql"
type post

header accept, application/json
header content-type, application/json
auth bearer @i(token)

body {
  query: @i(query)
  variables: @i(variables)
}
```

When multiple refs define the same key, later refs overwrite earlier refs.

## Local CLI and Development

Install the published package globally:

```bash
npm install -g ntee-r1quest
```

The package name is `ntee-r1quest`, and the CLI command is `r1q`:

```bash
r1q -r ./example/request
```

For local development:

```bash
npm install
npm run build
npm link
r1q -r ./example/request
```

Choose an AI adapter with:

```bash
r1q -r ./example/request -ai claude
```

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

From this repository root, add the local marketplace and install the plugin
inside Claude Code:

```bash
/plugin marketplace add ./skills/r1quest-ai-plugin
/plugin install r1quest-ai-plugin@r1quest-ai
```

The installed skills appear under the plugin namespace.

To use individual skills with Codex, import them from the plugin's `skills`
directory:

```bash
mkdir -p ~/.codex/skills
cp -R skills/r1quest-ai-plugin/plugin/skills/* ~/.codex/skills/
```

Or with `CODEX_HOME`:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/r1quest-ai-plugin/plugin/skills/* "${CODEX_HOME:-$HOME/.codex}/skills/"
```

To use individual skills globally with Cursor CLI:

```bash
mkdir -p ~/.cursor/skills
cp -R skills/r1quest-ai-plugin/plugin/skills/* ~/.cursor/skills/
```

Or install them only for the current project:

```bash
mkdir -p .cursor/skills
cp -R skills/r1quest-ai-plugin/plugin/skills/* .cursor/skills/
```

Once installed, ask Claude Code, Codex, or Cursor to generate requests from
OpenAPI, generate requests from a GraphQL schema, explain `.ntd`/`.nts` syntax,
run one-shot `-p` requests, or update files in an existing request root.
