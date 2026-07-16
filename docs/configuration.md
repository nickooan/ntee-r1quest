# Configuration

Everything `.r1qconfig.yaml` can do: lookup order, how multiple config files
combine, every field, and how the `sock` hand-off keeps history complete. For
a quick overview, see the [README](../README.md).

## Lookup order

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

`.r1qconfig.yml` is also accepted. `.r1qconfig.json` is not a valid config
file name. First-time setup: `r1q --init` creates the home config with a short
wizard.

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

## How config sources combine

Up to three config files are read and combined: the request-root directory's
config, the current directory's config, and the home config. They are not
deep-merged — each setting is resolved with this precedence (highest first):

```text
command-line flags  >  <request-root>/.r1qconfig.yaml  >  ./.r1qconfig.yaml  >  ~/.ntee-r1quest/r1qconfig.yaml
```

(The `root` value itself is resolved from the current directory and home
config before the request-root config is loaded.)

How each field combines:

- **Scalars** (`root`, `ai`, `sock`) are not merged. The first source that
  defines a non-empty value wins; later sources are ignored. A command-line
  flag (`-r`, `-ai`) always overrides config.
- **`custom-suggestions`** is a **union** of every source, deduplicated. All
  entries from all configs are offered.
- **`custom-ai-commands`** is merged **by command name**, and the first
  occurrence of a name wins. A `for-test` defined in the request-root config
  therefore shadows a `for-test` of the same name in the home config.

## Field reference

**`root`** — the request collection root. Overridden by `-r`.

**`ai`** — the AI adapter for `@ai` mode (`codex` | `claude` | `cursor`).
Overridden by `-ai`. If neither is set, `@ai` shows a configuration error.

**`custom-suggestions`** — user-defined editor suggestions for request header
keys and object body keys.

**`custom-ai-commands`** — reusable AI prompts invoked with `/name args` in AI
mode. Each entry needs a `name` and an `instruction`; `description` is
optional and shown in the suggestion popup. Positional placeholders (`$1`,
`$2`, ...) in the `instruction` are filled with the arguments typed after the
command name. Entries missing a `name` or `instruction` are skipped. See
[Custom AI commands](terminal-app.md#custom-ai-commands).

**`sock`** — when set, the terminal app listens on that Unix socket for
external request events. A `-p` execution posts its formatted response to the
socket when available, so an open terminal app can highlight the matching
request and show the result. `r1q --init` sets a default socket path under the
OS temp directory (e.g. `/tmp/ntee-r1quest.sock`).

The event also carries the **full call record**, which matters for history:
the request history store is **single-writer** — while a terminal app is open
it holds an exclusive lock, so a one-shot run cannot write history directly.
Instead, the one-shot hands its call record over the socket and the open app
(the lock holder) persists it, so history stays complete and the app sees the
call immediately. The two paths are mutually exclusive by construction:

- **App open + `sock` configured** — the app records the call (and highlights
  the request). The one-shot's own write is a clean no-op.
- **No app running** — the one-shot records history directly; the socket post
  quietly does nothing.
- **App open but `sock` not configured** — the one-shot's calls are not added
  to history for that overlap (the store is locked and there is no hand-off
  channel); everything else works normally. Configure `sock` to avoid this.

## Storage: ntee-db

r1quest uses [**ntee-db**](https://github.com/nickooan/ntee-db), an embedded
storage engine — a small, fast, pure-Go log-structured key–value store with
prefix search, secondary indexes, and capped self-evicting retention
(`maxPerValue`). It runs in-process (no separate database server or daemon),
loaded into the Node runtime through a native binding, and is the single store
behind everything the app persists locally:

- **Request history / response cache** — the latest call per endpoint, plus
  full trace collections.
- **Input history** — the query/view suggestions offered while typing.
- **AI sessions** — resumable agent session ids per adapter.
- **Edit-mode version snapshots** — the coalesced undo/redo timeline (Ctrl+Z /
  Ctrl+Y), capped at 50 versions per file.

It's tuned for this workload: caller-synchronous appends (so a one-shot CLI
run persists before it exits), fast prefix/index scans for the History list,
and automatic per-key retention with no manual cleanup. For the design, the
Node binding API, and head-to-head benchmarks against `lmdb` and
`better-sqlite3`, see the [ntee-db repository](https://github.com/nickooan/ntee-db)
(npm package [`ntee-db`](https://www.npmjs.com/package/ntee-db)).
