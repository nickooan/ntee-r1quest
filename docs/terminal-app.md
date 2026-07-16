# Using the terminal app

The complete guide to the `ntee-r1quest` terminal UI: modes, every key, the
suggestion popups, request history, and the AI chat. For installing and
running, see the [README](../README.md).

## Terminal Modes

The status line at the bottom shows the current mode and its keys, for example:

```text
@query >
@view   ↑/↓ scroll · e edit · s search · esc back
@edit   a.nts   editing   Ctrl+S save · Ctrl+F find · Ctrl+J/O jump/back · Ctrl+Z undo · esc discard
@search /uuid/   3/5   ↑/↓ next · esc back
@history 2/8   ↑/↓ scroll · shift+↑/↓ select · s search · esc back
@ai >
```

Switch modes by typing a mode command and pressing Enter. Commands that take an
argument accept it inline (`@v folder/get`, `@h task-42`):

| Command    | Alias | Purpose                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| `@query`   | `@q`  | Run request files and view responses (the default mode).    |
| `@view`    | `@v`  | Open a request or data file in the Result pane (read-only). |
| `@edit`    | `@e`  | Edit a file in the Result pane.                             |
| `@search`  | `@s`  | Search the current Result or reviewed file content.         |
| `@history` | `@h`  | Browse cached request/response history.                     |
| `@ai`      |       | Open the AI chat.                                           |

`@view` / `@edit` open the highlighted file when given no argument, or the file
at the given path (`@v folder/get`). In query mode you can also append the
command to a path — `folder/get @v` or `readme.md @e` — to open that file
directly.

Action commands run a task instead of switching modes:

| Command        | Alias     | Action                                                              |
| -------------- | --------- | ------------------------------------------------------------------- |
| `@copy`        | `@report` | Copy the Result pane content to the clipboard.                      |
| `@reload`      |           | Re-resolve config (root, AI adapter, custom commands) and adopt it. |
| `@clean-cache` | `@cc`     | Clear input history and request history.                            |
| `@exit`        | `@quit`   | Exit the app.                                                       |

`@copy` (alias `@report`) copies exactly what the Result pane shows — the
response, an open file, or a history record. On success the status line shows a
green `copied`; if there is nothing to copy or no clipboard tool is available
it shows `copy failed`. Clipboard support is macOS and Linux only.

Press **Shift+Tab** to cycle the three main modes:

```text
@query -> @history -> @ai -> @query
```

`@view`, `@edit`, and `@search` are entered explicitly (by command, or via the
shortcuts below); press **Esc** to leave them.

## Key Manual

### Global

| Key       | Action                                                   |
| --------- | -------------------------------------------------------- |
| Shift+Tab | Cycle the main modes: `@query` → `@history` → `@ai`.     |
| Enter     | Submit the current mode's input or act on the selection. |
| Esc       | Leave the current mode (to query, or up a directory).    |
| Ctrl+C    | Quit the app.                                            |

### Query Mode

Type any part of a request name — matching is **fuzzy, not prefix-only**. The
popup ranks exact matches first, then prefix, substring, and skipped-letter
(subsequence) matches, so `orders` finds `folder-2/sub-folder-1/get-orders-by-id`
and so does `gob`. The search covers the whole request root, including files
inside collapsed directories, and suggestions always show the full relative
path — Enter runs the pick directly. Fuzzy suggestions are scoped to `.nts`
requests; directories still complete by prefix for path navigation
(`folder-2/`).

| Key                      | Action                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type a keyword           | Fuzzy-filter requests; a suggestion popup lists matches with full paths.                                                                                              |
| Enter                    | Act on the highlighted entry by type: **enter** a directory, **run** a request (`.nts`), or **ask to view** any other file. A path that matches nothing does nothing. |
| Up / Down                | Navigate the suggestion popup when open; otherwise scroll the Result pane.                                                                                            |
| Left / Right             | Scroll the Result pane horizontally.                                                                                                                                  |
| Shift+Up / Shift+Down    | Move the selection on the left (sidebar / popup). The selected value is mirrored into the input bar and the popup.                                                    |
| Shift+Left / Shift+Right | Move the input cursor.                                                                                                                                                |
| Esc                      | Go up to the parent directory.                                                                                                                                        |

- Suggestions in **yellow** are files/folders; **green** marks recently run
  inputs (from the input-history cache, deduplicated against the file entries).
- Selecting a non-`.nts` file opens a confirm overlay ("not a r1q executable —
  view it?"): **y / Enter** opens it in view mode; **n / Esc** cancels (input
  cleared, file stays selected).
- Opening a binary/native file shows a "not a readable file" overlay; press
  **Enter** to dismiss (selection preserved).
- `<path> @v` / `<path> @e` opens that file directly in view / edit mode.

### View Mode

Read a file in the Result pane.

| Key       | Action                  |
| --------- | ----------------------- |
| Up / Down | Scroll the file.        |
| `e`       | Edit the file.          |
| `s`       | Search within the file. |
| Esc       | Return to query mode.   |

### Edit Mode

Edit the open file in place. (The Go front-end is the sole writer of
`.nts`/`.ntd` files; the runtime only reads them.)

| Key             | Action                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type text       | Insert at the cursor (replaces the current selection, if any).                                                                                                                                                                         |
| Enter           | Insert a newline.                                                                                                                                                                                                                      |
| Left / Right    | Move the cursor; a long line scrolls horizontally to keep the cursor in view.                                                                                                                                                          |
| Up / Down       | Move the cursor between lines; navigate the completion popup while open.                                                                                                                                                               |
| Tab             | Accept the highlighted completion.                                                                                                                                                                                                     |
| Backspace       | Delete before the cursor, or delete the selection.                                                                                                                                                                                     |
| Ctrl+A          | Select the word under the cursor; press again to grow to the `key:` / value segment, then to the whole line.                                                                                                                           |
| Ctrl+F          | Search the buffer; Enter in search jumps the cursor to the match (scrolling off-screen matches into view).                                                                                                                             |
| Ctrl+Z / Ctrl+Y | Undo / redo. History is coalesced by edit burst and persisted (up to 50 snapshots per file) via ntee-db.                                                                                                                               |
| Ctrl+S          | Save the file (stays in edit mode).                                                                                                                                                                                                    |
| Ctrl+J          | Jump to the file referenced by the selection or cursor token — a `ref` path, `@run(...)` target, `@f(...)` file, or `@i(key)` (lands on the line defining the key in the winning `.ntd`, cursor at column 0). Requires a saved buffer. |
| Ctrl+O          | Jump back to where the last Ctrl+J left from (up to 20 hops). The trail ends when you leave edit mode.                                                                                                                                 |
| Esc             | Clear the selection; if there is none, discard unsaved changes and return to view mode.                                                                                                                                                |

The status line shows a yellow **`editing`** badge while there are unsaved
changes and a green **`saved`** badge once the buffer matches disk.

Completions appear while typing request keywords, header names and values,
macros, definition keys, or `ref` paths, and adapt to the file being edited —
request `.nts`, joint chain, or `.ntd` definition:

- `hea` suggests `header`.
- `header cont` suggests header names such as `content-type` (with a trailing `, `).
- `header content-type, ` suggests common values such as
  `application/json; charset=utf-8`; `authorization ` schemes such as `Bearer `,
  `cache-control` values such as `no-store`, and so on.
- `type ` suggests HTTP methods; `auth ` suggests `bearer` / `basic`.
- `@` suggests macros such as `@i`, `@f`, and `@i(key)` values from referenced
  `.ntd` files (`@env` is offered only in `.ntd` buffers, where it is valid).
- `@i(` suggests referenced `.ntd` keys; `@f(` suggests files next to the
  request.
- `ref ../d` suggests matching directories and `.ntd` files.
- In a joint chain file the pool swaps to chain statements: `-` on a new line
  offers the `-> @run()` / `-> @pick()` step templates, `@` offers
  `@joint`/`@pick`/`@run`/`@i`, and `@run(` completes sibling `.nts` scripts
  (extension omitted). Request keywords like `url`/`type`/`header` disappear —
  they cannot parse in a joint file.
- Each row shows a faint kind tag (`macro`, `header`, `definition`, ...) on the
  right when the pane is wide enough.

### Search Mode

Search the current Result or reviewed file. Pass the query inline (`@s uuid`,
`@search order id`) or type it after entering. From edit mode, Ctrl+F opens
search over the buffer — there, Enter commits: it moves the editor cursor to
the focused match and returns to editing (instead of stepping to the next
match).

| Key          | Action                                   |
| ------------ | ---------------------------------------- |
| Type a query | Build the query; matches highlight live. |
| Down / Enter | Jump to the next match.                  |
| Up           | Jump to the previous match.              |
| Esc          | Return to the mode you searched from.    |

The status line shows the `current/total` match count. Search launched from
`@history` keeps the history list on the left.

### History Mode

Use `@history` (or `@h`) to browse previously run requests. The left pane lists
cached endpoints; the right pane shows the formatted request/response for the
selected one, with its duration in the header. See
[Request History and Cache](#request-history-and-cache) for what gets recorded.

Pass a trace id inline to view only that trace's calls, numbered in order:
`@h <traceId>` (bare `@h` / `@history` shows all endpoints).

| Key                   | Action                                   |
| --------------------- | ---------------------------------------- |
| Shift+Up / Shift+Down | Select an endpoint on the left.          |
| Up / Down             | Scroll the selected record on the right. |
| `s`                   | Search the selected record.              |
| Esc                   | Return to query mode.                    |

### AI Mode

Use `@ai` to chat with a local terminal AI agent (Claude Code, Codex, or
Cursor) through an ACP adapter. The agent can read, write, and run requests,
with the results reflected in the Result pane.

On entering `@ai`, if prior sessions exist a **session picker** appears:

| Key   | Action                                  |
| ----- | --------------------------------------- |
| ↑ / ↓ | Choose "New session" or a past session. |
| Enter | Start / resume the selected session.    |
| Esc   | Cancel back to query mode.              |

In the chat:

| Key                  | Action                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Type a prompt        | Compose a message.                                                      |
| `#keyword`           | Reference a file — see below.                                           |
| Enter                | Send (or accept the open suggestion popup).                             |
| Ctrl+J               | Insert a newline (compose multi-line prompts).                          |
| Shift+↑/↓ or Opt+↑/↓ | Move the input cursor between lines.                                    |
| Up / Down            | Scroll the transcript (↑ older, ↓ newer).                               |
| `y` / `n`            | Answer a permission request when shown.                                 |
| Esc                  | Dismiss the open popup, else leave AI mode (the session keeps running). |

While the agent works, a "_&lt;Agent&gt;_ is thinking…" indicator shows — the
name follows your `-ai` adapter (e.g. "Codex is thinking…"). The indicator
tracks the real turn: it stays on from send until the agent's turn actually
completes (or errors), so a long-running agentic task never looks "done"
early.

#### `#file` references

Type a standalone `#keyword` to reference a file or directory in your message:
a popup fuzzy-searches the whole request root — directories, `.nts`, and
`.ntd` files. Enter or Tab promotes the match to a compact `[filename]` /
`[dir-name]` pill (two files with the same name disambiguate with the relative
path); Esc declines and keeps the text literal. On send, the pill stays
readable in the transcript while the file travels to the agent as a
first-class ACP `resource_link` (a `file://` reference the agent can open) —
never a raw path pasted into the prose.

The trigger is deliberately strict: the `#` must start a word (`abc#x` never
fires), needs text right after it (`# x` never fires), and the popup shows
only while the cursor is inside the token.

#### Typing while the agent thinks

Pressing Enter mid-turn does the right thing per agent:

- **Claude** supports true steering — the message is sent immediately and
  injected into the running turn, so the agent incorporates it mid-run.
- **Codex / Cursor** don't accept prompts mid-turn, so the message queues
  locally (shown as a faint `⏳ queued:` row above the input) and is delivered
  as one merged follow-up turn the moment the current turn finishes. Queued
  tips keep their `[file]` pills, survive leaving AI mode, and are dropped
  (with a notice) on error, session stop, or `@reload`.

`@`-commands (`@query`, `@reload`, …) always act immediately — they are TUI
actions, never prompts.

#### Permission requests

When the agent asks to run a tool, a three-row banner appears above the input:
a yellow `⚠ PERMISSION REQUEST` badge, the requested action in bold, and the
answers color-coded — `[y] allow` in green, `[n] reject` in red.

#### Custom AI commands

Define reusable prompts as `custom-ai-commands` in `.r1qconfig.yaml` (see the
[configuration guide](configuration.md)) and invoke them in AI mode by typing
`/` followed by the command name and arguments:

```text
/for-test one two three
```

Arguments are positional: `$1`, `$2`, `$3`, ... in the command's `instruction`
are replaced with the words after the command name. Placeholders without a
matching argument expand to an empty string, and an unknown `/command` is sent
as-is. The expanded text is both shown in the chat and sent to the AI — and a
`[file]` reference passed as an argument still resolves inside the expansion.

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

**Input suggestions.** As you type in `@query`, a popup above the command line
offers fuzzy matches from the whole request tree — files and folders in
**yellow**, previously run inputs in **green** (a file that was recently run
keeps the green marker instead of appearing twice). Pick one with the popup
(Up/Down) or the sidebar (Shift+Up/Down); the selection is mirrored into the
input bar.

**Request history.** Every successful request is recorded by endpoint
(`/path [method]`, or `Operation [type]` for GraphQL). Browse it in
[History Mode](#history-mode): the latest request/response for each endpoint,
formatted with status and duration. A repeat call to the same endpoint replaces
its previous entry.

**Trace grouping.** Tag one-shot runs with `-ti <id>` to record them under a
shared trace. In History Mode, `@h <id>` lists just that trace's calls **in
the order they ran** — handy for reviewing a multi-step flow. A
[joint chain](writing-requests.md#joint-chain-files-jointnts) records every
step (including intermediates the terminal never displays) under its trace id
automatically.

**Clearing.** Run `@clean-cache` (or `@cc`) to wipe both input history and
request history (the cache lives under `~/.ntee-r1quest/cache/`).

Everything the app persists locally — request history, input history, AI
session ids, and edit-mode undo snapshots — lives in
[**ntee-db**](https://github.com/nickooan/ntee-db), a small embedded pure-Go
log-structured key–value store loaded into the Node runtime through a native
binding (no separate database server). It is tuned for this workload:
caller-synchronous appends so a one-shot run persists before it exits, fast
prefix scans for the History list, and capped per-key retention (e.g. 50 undo
snapshots per file) with no manual cleanup.

## AI Adapter

Choose an AI adapter with `-ai`:

```bash
npx ntee-r1quest -r ./example/request -ai codex     # or: claude · cursor
```

Supported adapters:

- `codex`
- `claude` for Claude Code
- `cursor` for Cursor CLI (requires the Cursor CLI `agent` command installed
  and authenticated; started as an ACP server with `agent acp`)

If `-ai` is not provided, `ntee-r1quest` reads `.r1qconfig.yaml`. If no adapter
is declared, `@ai` shows a configuration error instead of choosing one
implicitly.

### AI Debug Log

For diagnosing AI sessions (for example a "thinking" indicator that seems
stuck), set the `R1QUEST_ACP_DEBUG` environment variable to record the ACP
exchange to a file:

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

The log is disabled unless the variable is set, is best-effort, and never
affects the app. Reproduce the issue, then read the file (for example
`tail -f ~/.ntee-r1quest/acp-debug.log`).
