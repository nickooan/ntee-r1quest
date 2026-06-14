---
name: r1quest-one-shot-runner
description: Locate and execute one ntee-r1quest .nts request as a one-shot command. Use when a user asks to run, call, trigger, or execute a named API collection and request, such as "run google-api get-orders-by-id".
argument-hint: "<collection-name> <request-name>"
---

# R1Quest One-Shot Runner

Use this skill when the user wants to execute one existing R1Quest request
without opening the terminal app.

## Resolve The Target

Interpret a request such as:

```text
run google-api get-orders-by-id
```

as:

- Collection: `google-api`
- Request: `get-orders-by-id`

Resolve the configured collection root in this order:

1. Explicit root provided by the user, or `-r <root>`.
2. `root` in the current directory's `.r1qconfig.yaml`.
3. `root` in `~/.ntee-r1quest/r1qconfig.yaml`.
4. Current working directory.

Locate the collection under the root. Then locate the request `.nts` file
inside that collection. Search common layouts:

```text
<root>/<collection>/<request>.nts
<root>/<collection>/request/<request>.nts
<root>/<collection>/**/<request>.nts
```

Use `rg --files <collection-path> | rg '(^|/)<request>(\.nts)?$'` or equivalent
file discovery. Match the exact request name before considering partial
matches.

If multiple exact matches exist, ask the user which one to run. If no exact
match exists, report close `.nts` candidates instead of guessing.

## Execute One Shot

Run the selected request with:

```bash
r1q -r <collection-path> -p <request-path-relative-to-collection>
```

The `-p` value may include or omit `.nts`.

Example:

```bash
r1q -r ~/collections/google-api -p request/get-orders-by-id
```

Use `npx ntee-r1quest` instead of `r1q` only when the installed `r1q` command is
not available.

## Safety And Reporting

- Read the target `.nts` and its referenced `.ntd` files before execution.
- Identify required `@env(...)` variables and report missing variables before
  running.
- Do not modify request or definition files unless the user asks.
- Treat the request as a real network action and clearly state the target
  method and URL before running mutating methods such as `post`, `put`,
  `patch`, or `delete`.
- After execution, report the resolved collection, request path, command used,
  and response status or error.
