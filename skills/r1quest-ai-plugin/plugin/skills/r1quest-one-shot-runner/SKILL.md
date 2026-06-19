---
name: r1quest-one-shot-runner
description: Locate and execute ntee-r1quest .nts requests as one-shot commands. Use when a user asks to run, call, trigger, or execute a named request — one request ("run google-api get-orders-by-id") or an ordered task of several requests where earlier responses feed later ones ("get-property-by-name then get-property-setup").
argument-hint: "<collection-name> <request-name> [then <request-name> ...]"
---

# R1Quest One-Shot Runner

Use this skill when the user wants to execute one existing R1Quest request, or
an ordered task of several requests, without opening the terminal app.

If the user names a single request, follow **Resolve The Target** then **Execute
One Shot**. If the user names more than one request as a sequence (e.g. "A then
B", "run A, then B, then C"), follow **Run A Task** to chain them.

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

Optional flags:

- `-env '{"KEY":"value"}'` supplies `@env(...)` values as a JSON object, merged
  over `process.env` (these win on duplicate keys). Use this to provide required
  variables instead of exporting them in the shell.
- `-ti <id>` tags the run with a trace id so related requests group in the app's
  history. Optional.

## Run A Task (Chained Requests)

Treat the request as a task when the user names more than one request in order,
e.g. "get-property-by-name then get-property-setup" or "run A, then B, then C".
Run them as an ordered chain where earlier responses can supply `@env(...)`
inputs for later requests, and every run shares one trace id.

### 1. Plan and confirm (before running anything)

Resolve and read every request in order — each `.nts` and all the `.ntd` files
it `ref`s. For each request collect:

- its method and URL,
- every `@env(KEY)` it needs that is not already satisfied (not in the
  environment, not going to be passed, and with no `or` default),
- for each unsatisfied key, its source: a value the user gives, or a field from
  an earlier request's response (match by name, e.g. a response `propertyId`
  satisfies `@env(propertyId)`).

Present a numbered execution plan: one line per request with its method, URL, the
`@env` inputs it needs, and where each value comes from (literal / environment /
"from step N response field X"). List any `@env` you cannot source and ask the
user to provide it. **Ask the user to confirm the plan before executing.**

### 2. Generate one trace id

Create one short unique id for the whole task (for example `task-<timestamp>` or
a short random token) and reuse it for every request, so the runs group together
in history (`@h <id>`).

### 3. Run each request in order

For each request, in sequence:

- Build `-env` from values gathered so far (user-provided plus fields extracted
  from earlier responses) and run the one-shot command with `-ti <traceId>`:

  ```bash
  r1q -r <collection-path> -p <request> -env '{"propertyId":"123"}' -ti <traceId>
  ```

  The first request usually needs no extracted `-env` (only user-provided
  values, if any); later requests carry forward what earlier ones produced.

- After it returns, inspect the response for fields that satisfy a later
  request's `@env` inputs and record them. State the mapping you chose
  (response field → `@env(KEY)`).
- Report this step: method/URL, status, and the values passed forward.

### 4. Stop on any failure

If a request returns an API error (non-2xx) or a runtime/compile error, **stop
immediately** — do not run the remaining requests. Present the failing step, the
exact command used, and the error response.

### 5. Continue to the end, then summarize

Repeat step 3 for every remaining request. When the task completes, summarize it:
each step's status, the values chained between steps, and the shared trace id.

Apply all **Safety And Reporting** rules to every request in the chain — in
particular, state the method and URL and confirm before any mutating request
(`post`, `put`, `patch`, `delete`).

### Example

User: "get-property-by-name then get-property-setup".

Plan presented for confirmation:

```text
trace id: task-20260619-01
1. get-property-by-name   GET  /properties?name=...   needs: @env(name) (you provide)
2. get-property-setup     POST /properties/@i(propertyId)/setup
                                                       needs: @env(propertyId) (from step 1 response field "id")
```

After confirmation:

```bash
# Step 1 — run, then read "id" from the response
r1q -r <root> -p get-property-by-name -env '{"name":"Acme HQ"}' -ti task-20260619-01
# response: { "id": "p_123", ... }  -> propertyId = "p_123"

# Step 2 — pass the extracted value forward, same trace id
r1q -r <root> -p get-property-setup -env '{"propertyId":"p_123"}' -ti task-20260619-01
```

If step 1 fails, do not run step 2 — report the error instead.

## Safety And Reporting

- Read the target `.nts` and its referenced `.ntd` files before execution.
- Identify required `@env(...)` variables and report missing variables before
  running. A variable is satisfied if it is set in the environment, passed via
  `-env`, or has an `or` default like `@env(KEY or "fallback")`.
- Do not modify request or definition files unless the user asks.
- Treat the request as a real network action and clearly state the target
  method and URL before running mutating methods such as `post`, `put`,
  `patch`, or `delete`.
- After execution, report the resolved collection, request path, command used,
  and response status or error.
