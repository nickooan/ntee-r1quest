---
name: r1quest-config-editor
description: Read and modify ntee-r1quest .r1qconfig.yaml configuration. Use when a user asks to view, add, or change R1Quest config such as the request root, AI adapter, socket path, custom editor suggestions, or custom AI commands.
argument-hint: "[config-path]"
---

# R1Quest Config Editor

Use this skill when a user wants to inspect or change `ntee-r1quest`
configuration, for example setting the request `root`, choosing an AI adapter,
enabling the external-event `sock`, adding `custom-suggestions`, or defining
`custom-ai-commands`.

## Config File Locations

`ntee-r1quest` reads up to three config files:

- `./.r1qconfig.yaml` — the current working directory's config.
- `<request-root>/.r1qconfig.yaml` — the resolved collection root's config.
- `~/.ntee-r1quest/r1qconfig.yaml` — the user's home config.

Rules:

- `.r1qconfig.yml` is also accepted.
- `.r1qconfig.json` is **not** a valid config file name.
- The home config file is `r1qconfig.yaml` (no leading dot) inside the
  `~/.ntee-r1quest/` directory.

Create the home config interactively when it is missing:

```bash
npx ntee-r1quest --init
```

## How Sources Combine

The three files are combined, not deep-merged. Each setting resolves with this
precedence (highest first):

```text
command-line flags  >  <request-root>/.r1qconfig.yaml  >  ./.r1qconfig.yaml  >  ~/.ntee-r1quest/r1qconfig.yaml
```

The `root` value itself is resolved from the current directory and home config
before the request-root config is loaded.

Per-field combination:

- **Scalars** (`root`, `ai`, `sock`) are not merged. The first source that
  defines a non-empty value wins. A command-line flag (`-r`, `-ai`) overrides
  config.
- **`custom-suggestions`** is a union of all sources, deduplicated.
- **`custom-ai-commands`** is merged by command `name`; the first occurrence of
  a name wins, so a root-directory command shadows a home command of the same
  name.

## Fields

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

- `root` — path to the request collection root. `~` expands to the home
  directory; a relative path resolves against the config file's directory.
- `ai` — AI adapter: `codex`, `claude`, or `cursor`.
- `sock` — Unix socket path. When set, an open terminal app listens for external
  request events, and `-p` one-shot runs post their formatted response to it.
- `custom-suggestions` — extra editor suggestions offered for request header
  keys and object body keys.
- `custom-ai-commands` — reusable AI prompts invoked in AI mode as
  `/name arg1 arg2`. Each entry needs a `name` and an `instruction`;
  `description` is optional and shown in the suggestion popup. Positional
  placeholders `$1`, `$2`, ... in the `instruction` are replaced with the
  arguments typed after the command name. Entries missing a `name` or
  `instruction` are ignored.

## Editing Workflow

1. Decide which file to edit:
   - User-global defaults → `~/.ntee-r1quest/r1qconfig.yaml`.
   - Project- or collection-specific settings → the project's or request-root's
     `.r1qconfig.yaml`.
2. Read the existing config file first. If it does not exist, create it (and the
   `~/.ntee-r1quest/` directory for the home config) only after confirming the
   target path.
3. Preserve unrelated keys, ordering, and comments; change only what the user
   asked for.
4. Keep the file valid YAML. Quote string values that contain `://`, `//`,
   commas, braces, brackets, or newlines.
5. For list fields (`custom-suggestions`, `custom-ai-commands`), append new
   entries instead of replacing the list, and avoid duplicate names.
6. Report which file changed and remind the user that changes take effect on the
   next launch or after `@reload` in a running app (reload re-scans config from
   disk).

## Common Changes

Set the request root:

```yaml
root: ~/collections/google-api
```

Choose an AI adapter:

```yaml
ai: claude
```

Add custom editor suggestions:

```yaml
custom-suggestions:
  - x-correlation-id
  - x-trace-token
```

Add a custom AI command (invoked later as `/hello-from Bob`):

```yaml
custom-ai-commands:
  - name: hello-from
    description: introduce yourself
    instruction: Hi my name is $1
```

## Validation

After editing:

1. Re-read the changed file and confirm it parses as YAML.
2. Confirm `ai` is one of `codex`, `claude`, or `cursor`.
3. Confirm each `custom-ai-commands` entry has a non-empty `name` and
   `instruction`, and that `$N` placeholders match the arguments the user
   intends to pass.
4. Confirm `root` and `sock` paths are correct, noting `~` and relative-path
   resolution.
5. State which config file the values will come from given the precedence rules
   when multiple files define the same setting.
