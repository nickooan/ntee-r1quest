# ntee-r1quest

`ntee-r1quest` is a Postman-like terminal app for running HTTP requests from a
file-based collection.

Collections are plain files, so teams can keep them in Git, generate them from
Swagger/OpenAPI specs, review changes in pull requests, and run the same request
set locally.

```bash
npx ntee-r1quest -r ./example/request
```

![ntee-r1quest terminal demo](https://codeberg.org/nickoan/ntee-r1quest/raw/branch/main/docs/assets/readme-demo.gif)

## Quick Start

`ntee-r1quest` targets Node.js 24 or newer.

```bash
node --version
```

Run a request collection with `npx`:

```bash
npx ntee-r1quest -r ./example/request
```

Inside the app, type a request path without `.nts`, then press Enter:

```text
@query >example
```

Nested request paths work too:

```text
@query >folder-1/get-post
```

If `-r` is omitted, `ntee-r1quest` looks for `.r1qconfig.json`, then falls back
to the current directory as the request root.

Run one request without opening the terminal app:

```bash
npx ntee-r1quest -r ./example/request -p folder-1/get-post
```

The `-p` value may include or omit `.nts`.

## Terminal Modes

The prompt shows the current mode:

```text
@query >
@view >
@edit >
@search >
@ai >
```

Switch modes by typing a mode command and pressing Enter:

| Command   | Alias   | Purpose                                             |
| --------- | ------- | --------------------------------------------------- |
| `@query`  | `@q`    | Run request files and view responses.               |
| `@view`   | `@v`    | Review request or data files in the Result pane.    |
| `@edit`   | `@e`    | Edit the currently reviewed file.                   |
| `@search` | `@s`    | Search the current Result or reviewed file content. |
| `@ai`     | `@a`    | Open the AI chat overlay.                           |
| `@exit`   | `@quit` | Exit the app.                                       |

You can also press Shift+Tab to cycle modes:

```text
@query -> @view -> @search -> @ai -> @query
```

When the cycle enters `@ai`, the AI overlay opens. When it cycles out of `@ai`,
the overlay closes and the AI session remains available.

## Key Manual

### Global

| Key              | Action                                                  |
| ---------------- | ------------------------------------------------------- |
| Shift+Tab        | Quick-switch through query, view, search, and AI modes. |
| Enter            | Submit the current mode input or selected item.         |
| `@exit`, `@quit` | Exit the app safely.                                    |

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

### Edit Mode

Use `@edit` while reviewing a file to edit it directly in the Result pane.

| Key                      | Action                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| Type text                | Buffer text at the edit cursor.                                     |
| Enter                    | Insert buffered text, split a line, or accept an active suggestion. |
| Esc                      | Open the save confirmation prompt.                                  |
| Up / Down                | Move the file cursor, unless suggestions are visible.               |
| Left / Right             | Move the file cursor horizontally.                                  |
| Shift+Left / Shift+Right | Move the buffered input cursor.                                     |
| Backspace / Delete       | Delete buffered text, or delete file content before the cursor.     |

Editor suggestions appear while typing request keywords, macros, definition
keys, or `ref` paths.

| Key       | Action                                                         |
| --------- | -------------------------------------------------------------- |
| Up / Down | Move the highlighted suggestion while the dropdown is visible. |
| Tab       | Apply the highlighted suggestion.                              |
| Enter     | Apply the highlighted suggestion.                              |

Examples:

- `hea` suggests `header`.
- `@` suggests macros such as `@i`, `@f`, `@env`, and concrete `@i(key)` values
  from referenced `.ntd` files.
- `@i(` suggests referenced `.ntd` keys.
- `ref ../d` suggests matching directories and `.ntd` files, such as
  `../data/` or `../default.ntd`.

### Search Mode

Use `@search` to search the current response or reviewed file.

| Key                      | Action                                 |
| ------------------------ | -------------------------------------- |
| Type a search query      | Prepare a search query.                |
| Enter                    | Apply the query and highlight matches. |
| Up / Down                | Move between matches.                  |
| Left / Right             | Scroll horizontally.                   |
| PageUp / PageDown        | Scroll vertically by one page.         |
| Home / End               | Jump to the first or last match.       |
| Shift+Left / Shift+Right | Move the search input cursor.          |

If you enter `@edit` from search while reviewing a file, editing starts near the
focused match.

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

## AI Adapter

Choose an AI adapter with `-ai`:

```bash
npx ntee-r1quest -r ./example/request -ai codex
```

or:

```bash
npx ntee-r1quest -r ./example/request -ai claude
```

Supported adapters:

- `codex`
- `claude` for Claude Code

If `-ai` is not provided, `ntee-r1quest` reads `.r1qconfig.json`. If no adapter
is declared, `@ai` shows a configuration error instead of choosing one
implicitly.

## Config

Config lookup checks the current directory first:

```text
./.r1qconfig.json
```

When a request root is resolved, its config is also loaded:

```text
<request-root>/.r1qconfig.json
```

Then it checks the home config:

```text
~/.ntee-r1quest/.r1qconfig.json
```

Example:

```json
{
  "root": "~/example-api-collection",
  "ai": "codex",
  "sock": "/tmp/ntee-r1quest.sock"
}
```

Command-line options take precedence over config values.

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
- `@env(KEY)` environment variable macro

Rules and cautions:

- Wrap URLs in double quotes. Unquoted `http://` or `https://` contains `//`,
  which starts a comment.
- Bare values default to strings unless they are `true`, `false`, `null`, or a
  number.
- Keys may be bare identifiers such as `content-type`, or quoted strings when
  needed.
- `.ntd` files can use `@env(KEY)`, but cannot use `@i(...)` or `@f(...)`.
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
- `@f(...)` is only valid inside request body values.
- `@f(...)` takes a literal file path, not an `@i(...)` macro.
- File paths in `@f(...)` are resolved relative to the `.nts` file.
- `@f(...)` cannot be used in headers or authorization.
- `@f(...)` cannot be used as the entire body by itself.
- Comments start with `//`.

## Macros

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

If the environment variable is missing, compilation throws an error.

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

This repo includes a Claude Code plugin with AI skills for generating,
understanding, running, and editing `ntee-r1quest` projects:

```text
skills/r1quest-ai-plugin/
  .claude-plugin/plugin.json
  skills/openapi-r1quest-generator/SKILL.md
  skills/r1quest-language-runtime/SKILL.md
  skills/r1quest-project-editor/SKILL.md
```

The OpenAPI generator skill creates a project shape like:

```text
<output-dir>/<project-name>/
  data/
    common.ntd
    auth.ntd
    <operation-name>.ntd
  get-property.nts
  create-property.nts
```

Install it into Claude Code from this repository root:

```bash
claude plugin install ./skills/r1quest-ai-plugin
```

Import individual skills into Codex globally:

```bash
mkdir -p ~/.codex/skills
cp -R skills/r1quest-ai-plugin/skills/openapi-r1quest-generator ~/.codex/skills/openapi-r1quest-generator
cp -R skills/r1quest-ai-plugin/skills/r1quest-language-runtime ~/.codex/skills/r1quest-language-runtime
cp -R skills/r1quest-ai-plugin/skills/r1quest-project-editor ~/.codex/skills/r1quest-project-editor
```

Or with `CODEX_HOME`:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/r1quest-ai-plugin/skills/openapi-r1quest-generator "${CODEX_HOME:-$HOME/.codex}/skills/openapi-r1quest-generator"
cp -R skills/r1quest-ai-plugin/skills/r1quest-language-runtime "${CODEX_HOME:-$HOME/.codex}/skills/r1quest-language-runtime"
cp -R skills/r1quest-ai-plugin/skills/r1quest-project-editor "${CODEX_HOME:-$HOME/.codex}/skills/r1quest-project-editor"
```

Once installed, ask Claude Code or Codex to generate requests from OpenAPI,
explain `.ntd`/`.nts` syntax, run one-shot `-p` requests, or update files in an
existing request root.
