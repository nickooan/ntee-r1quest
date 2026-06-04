---
name: r1quest-language-runtime
description: Understand ntee-r1quest .ntd and .nts syntax, request keywords, macros, config behavior, and one-shot -p execution. Use when explaining, reviewing, fixing, or running individual R1Quest request scripts.
argument-hint: "[request-path]"
---

# R1Quest Language And Runtime

Use this skill when a user asks how `.ntd` or `.nts` files work, asks for help
fixing request syntax, or wants to run one request without opening the terminal
app.

## File Roles

- `.ntd` files define reusable data for intermediate macros.
- `.nts` files define executable HTTP requests.
- `.nts` files load `.ntd` files with `ref` statements.
- `ref` paths are resolved relative to the `.nts` file that declares them.
- File paths in `@f(...)` are resolved relative to the `.nts` file.

## `.ntd` Grammar Notes

Definition files are key-value documents:

```ntd
host: "https://api.example.com"
content-type: application/json
token: @env(API_TOKEN)
payload: {
  name: "Example"
  enabled: true
}
```

Use these rules:

- Define keys with `key: value`.
- Use objects and arrays for structured request bodies.
- Use `@env(KEY)` in `.ntd` files for environment values.
- Do not use `@i(...)` in `.ntd` files.
- Do not use `@f(...)` in `.ntd` files.
- Quote strings that include `://`, `//`, commas, braces, brackets, or newlines.

## `.nts` Grammar Notes

Request files declare one request:

```nts
ref ./data/common.ntd

url "@i(host)/users/@i(user-id)"
type get

header accept, @i(accept)
auth bearer @i(token)
```

Supported request statements:

- `ref <path>` loads a `.ntd` file. Put all refs before other statements.
- `url <value>` sets the request URL.
- `type <method>` sets the HTTP method, such as `get`, `post`, `put`, or
  `delete`.
- `header <key>, <value>` adds a request header. Header keys compile to
  lowercase.
- `auth bearer <value>` sets bearer auth.
- `auth basic <value>` sets basic auth.
- `body <value>` sets the request body.

Use these macro rules:

- `@i(key)` reads a value from referenced `.ntd` files.
- `@env(KEY)` belongs in `.ntd`, not `.nts`.
- `@f(path)` is valid only inside request body values.
- Header and auth values must resolve to primitive values.

## Content Types

Runtime execution dispatches by `content-type`:

- `application/json` sends JSON bodies.
- `multipart/form-data` sends object bodies as form data and supports `@f(...)`.
- `text/*` sends string bodies.

Requests without a supported or missing `content-type` will fail before sending.

## One-Shot `-p` Execution

Use `-p` to run a single request and print the formatted response without
opening the terminal UI:

```bash
npx ntee-r1quest -r ./example/request -p folder-1/get-post
```

Equivalent installed command:

```bash
r1q -r ./example/request -p folder-1/get-post.nts
```

Rules:

- `-p` accepts paths with or without `.nts`.
- The path is resolved under the request root from `-r`, config, or cwd.
- `ref` and `@f(...)` paths still resolve relative to the `.nts` file.
- If `.r1qconfig.json` defines `sock`, one-shot execution posts the formatted
  response to the socket for an open terminal app.

## Validation Workflow

When checking a request:

1. Identify the request root from `-r`, `.r1qconfig.json`, or the cwd.
2. Locate the target `.nts` file, adding `.nts` if omitted.
3. Read all referenced `.ntd` files.
4. Check that all `@i(key)` macros are defined by referenced `.ntd` files.
5. Check that `@env(KEY)` variables exist or clearly report they are required.
6. Check that every `@f(path)` target exists and is only used in `body`.
7. Prefer `r1q -r <root> -p <request>` for one-shot verification when the user
   wants to run the request.
