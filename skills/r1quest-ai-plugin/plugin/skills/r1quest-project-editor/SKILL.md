---
name: r1quest-project-editor
description: Scan and edit an existing ntee-r1quest request root. Use when asked to inspect, update, or refactor .ntd data files and .nts request files in the current project.
argument-hint: "[request-root]"
---

# R1Quest Project Editor

Use this skill when a user wants help updating an existing `ntee-r1quest`
collection, including `.ntd` data values, `.nts` requests, headers, auth, URLs,
or bodies.

## Find The Request Root

Resolve the request root in this order:

1. Explicit user-provided root.
2. `-r <root>` from the command the user is using.
3. `.r1qconfig.yaml` `root`.
4. Current working directory.

If the user points at a root such as `./example`, scan below that directory. If
request files live in a nested `request/` directory, preserve that layout unless
the user asks to move files.

## Scan The Collection

Before editing:

- List `.nts` files under the root.
- List `.ntd` files under the root.
- For each `.nts`, read its `ref` statements.
- Resolve each ref relative to the `.nts` file.
- Build a map from request files to referenced data files.
- Build a map of `.ntd` keys to values by file.
- Search for affected keys, URLs, headers, auth statements, and body macros
  with `rg` before editing.

Prefer `rg --files` and `rg` for discovery.

## Editing Rules

When updating `.ntd` files:

- Preserve existing key names if requests already reference them.
- Update shared values in the most specific existing `.ntd` file that already
  owns that concept.
- Add new keys near related keys.
- Quote strings containing `://`, `//`, commas, braces, brackets, or newlines.
- Use `@env(KEY)` for secrets, tokens, and environment-specific credentials.

When updating `.nts` files:

- Keep all `ref` statements before request statements.
- Use `@i(key)` for reusable host, path, query, header, auth, and body values.
- Use `@f(path)` only inside body values.
- Keep header keys lowercase-friendly and expect runtime normalization.
- Do not duplicate data literals in many `.nts` files when an `.ntd` key is the
  clearer shared source.

## Common Changes

Host/base URL update:

- Prefer editing a shared `host` key in `.ntd`.
- If no shared key exists, add one and update `.nts` URLs to use `@i(host)`.

Auth update:

- Prefer a dedicated auth `.ntd` file.
- Use `token: @env(API_TOKEN)` or a project-specific environment variable.
- Update `.nts` with `auth bearer @i(token)` or the correct auth/header mapping.

Payload update:

- Store reusable request body examples as objects in `.ntd`.
- Reference them with `body @i(payload-key)`.
- Keep request-specific body data in operation-specific `.ntd` files.

File upload update:

- Use `header content-type, multipart/form-data`.
- Use object body values.
- Use `@f(relative-file-path)` only inside the body object.

## Validation

After editing:

1. Re-read changed `.nts` and `.ntd` files.
2. Confirm referenced files exist.
3. Confirm every changed or added `@i(key)` is defined by a referenced `.ntd`.
4. Confirm every changed or added `@f(path)` exists relative to its `.nts` file.
5. Run focused tests or the local compiler if available.
6. If the user wants to execute the request, use `r1q -r <root> -p <request>`.

Report changed files, validation performed, and any required environment
variables or placeholder files.
