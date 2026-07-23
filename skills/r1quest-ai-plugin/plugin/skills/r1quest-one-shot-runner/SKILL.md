---
name: r1quest-one-shot-runner
description: Locate and execute ntee-r1quest .nts requests as one-shot commands. Use this whenever a user asks to run, call, trigger, or execute one or more named requests, referenced by name or path (with or without .nts) — a single request ("run google-api get-orders-by-id", "run folder-2/create-post") or several in sequence ("run folder-2/create-post then folder-2/update-post"), chained via a generated @joint file or per-step -env passing. This is THE skill for actually executing requests.
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

**Prefer a joint chain file**: generate a temporary `.joint.nts` file and run
the whole chain with a single command. Fall back to per-step orchestration only
when the chain does not qualify (see the fallback section).

### 1. Plan and confirm (before running anything)

Resolve and read every request in order — each `.nts` and all the `.ntd` files
it `ref`s. For each request collect:

- its method and URL,
- every `@env(KEY)` it needs that is not already satisfied (not in the
  environment, not going to be passed, and with no `or` default),
- for each unsatisfied key, its source: a value the user gives, or a json path
  into an earlier request's response body. A response field satisfies
  `@env(KEY)` only on an exact key match (e.g. a response `propertyId` for
  `@env(propertyId)`); NEVER assume a fuzzy match such as `id` for
  `@env(propertyId)` — propose it in the plan and let the user confirm it.

Present a numbered execution plan: one line per request with its method, URL, the
`@env` inputs it needs, and where each value comes from (literal / environment /
"from step N response, json path X"). List any `@env` you cannot source and ask
the user to provide it. **Ask the user to confirm the plan before executing.**

### 2. Preferred: generate and run a temporary joint file

A joint file turns the plan into an engine-executed chain: every step runs in
order, shares one trace id, records to history, and only the final response is
printed. Requirements — all steps must be `application/json` requests with JSON
responses, every carried-forward value must be expressible as a rename plus a
json path (`envKey: path.to[0].value`), and no step may itself be a joint file.

Generate the task id as `<YYYYMMDD-HHMMSS>` (so the trace id is
`task-<YYYYMMDD-HHMMSS>`) and write the file at the collection root as
`.r1q-task-<id>.joint.nts`:

```text
@joint("task-<id>")

-> @pick(name: @i(default-name))          // optional first pick: only @i(...) context values
-> @run(queries/get-property-by-name)     // paths relative to this file
-> @pick(propertyId: data.property.id)    // json paths read the previous response body
-> @run(queries/get-property-setup)
```

Rules:

- `@joint("<trace-id>")` comes after any `ref` lines; steps follow as
  `-> @pick(...)` / `-> @run(...)` pairs (the pick is optional per step).
- `@pick(key: <source>, ...)` merges values into the chain env passed to every
  later step via the `@env(...)` mechanism. A source is either a json path into
  the previous response body (`data.items[0].id`) or `@i(key)` from the joint
  file's own `ref`'d `.ntd` context.
- User-provided values still go in via `-env` on the command line; picked values
  override them on duplicate keys.

Run it once, then delete the temp file. Deletion is unconditional: remove the
file whether the run succeeds, a step fails, or the run is interrupted — never
leave `.r1q-task-*` files in the collection:

```bash
r1q -r <root> -p .r1q-task-<id>.joint
rm <root>/.r1q-task-<id>.joint.nts
```

The output is the final step's response plus the trace id; every step (including
intermediates) is recorded in history — inspect with `@h task-<id>` in the app.
If a step fails, the run stops, prints `Joint step N/M (<target>) failed.` with
the failing response or error, and exits non-zero.

### Fallback: run each request separately

Use per-step one-shot commands instead of a joint file when:

- the user must confirm individual mutating steps (`post`/`put`/`patch`/
  `delete`) as they happen,
- any step's request or response is not `application/json`,
- a carried-forward value needs a transformation beyond rename + json path, or
- choosing a later step's input requires reasoning about an earlier response
  rather than a fixed path.

Generate one trace id for the whole task in the form `task-<YYYYMMDD-HHMMSS>`
(e.g. `task-20260723-141502`), then for each request in sequence:

- Build `-env` from values gathered so far (user-provided plus fields extracted
  from earlier responses) and run with `-ti <traceId>`:

  ```bash
  r1q -r <collection-path> -p <request> -env '{"propertyId":"123"}' -ti <traceId>
  ```

- After it returns, inspect the response for fields that satisfy a later
  request's `@env` inputs and record them. Apply the exact-key-match rule from
  the planning step; state every mapping you use (response field →
  `@env(KEY)`).
- Report this step: method/URL, status, and the values passed forward.
- If a request returns an API error (non-2xx) or a runtime/compile error,
  **stop immediately** — do not run the remaining requests. Present the failing
  step, the exact command used, and the error response.

When the task completes, summarize it: each step's status, the values chained
between steps, and the shared trace id.

Apply all **Safety And Reporting** rules to every request in the chain — in
particular, state the method and URL and confirm before any mutating request
(`post`, `put`, `patch`, `delete`).

### Example

User: "get-property-by-name then get-property-setup".

Plan presented for confirmation:

```text
trace id: task-20260619-141502
1. get-property-by-name   GET  /properties?name=...   needs: @env(name) (you provide)
2. get-property-setup     POST /properties/@i(propertyId)/setup
                                                       needs: @env(propertyId) (from step 1 response, json path "id")
```

After confirmation, generate `<root>/.r1q-task-20260619-141502.joint.nts`:

```text
@joint("task-20260619-141502")

-> @run(get-property-by-name)
-> @pick(propertyId: id)
-> @run(get-property-setup)
```

Run it (user-provided values via `-env`), then delete the temp file:

```bash
r1q -r <root> -p .r1q-task-20260619-141502.joint -env '{"name":"Acme HQ"}'
rm <root>/.r1q-task-20260619-141502.joint.nts
```

If step 1 fails, the chain stops on its own — report the failing step and the
error. Inspect the full chain later with `@h task-20260619-141502`.

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
