---
name: r1quest-language-runtime
description: Understand ntee-r1quest .ntd and .nts syntax, request keywords, macros (including `or` defaults), config behavior, and one-shot -p/-env/-ti execution. Use when explaining, reviewing, authoring, or fixing the syntax of individual R1Quest request scripts. To actually run/execute requests, use the r1quest-one-shot-runner skill instead.
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
- Provide a default with `@env(KEY or <value>)`, used when the variable is
  unset. The default must be an immediate string, number, or boolean — never
  another macro. Examples: `@env(PORT or 8080)`, `@env(TOKEN or "dev")`,
  `@env(DEBUG or false)`.
- `@env(...)` may stand alone as a value or be embedded inside a bare (unquoted)
  value, where it resolves and is spliced into the surrounding text. Example:
  `path: /todos/@env(id or 1)` compiles to `/todos/1` (or `/todos/<value>` when
  set). A standalone `@env(...)` keeps its native type; an embedded one is
  stringified. Embedding works only in bare values — inside a quoted string the
  `@env(...)` text stays literal (e.g. `"/todos/@env(id)"` is verbatim), and a
  non-macro `@` such as `/users/@me` is preserved as-is.
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
- Provide a default with `@i(key or <value>)`, used when the key is missing from
  the referenced `.ntd` files. The default must be an immediate string, number,
  or boolean — never another macro. Examples: `@i(accept or "application/json")`,
  `@i(age or 20)`, `@i(deleted or true)`.
- `@env(KEY)` belongs in `.ntd` only. Using `@env(...)` anywhere in a `.nts`
  file (value, header, or string) is a compile error
  (`Unsupported macro operator: env`) — read it in a `.ntd` and reference it with
  `@i(...)`.
- `@f(path)` is valid only inside request body values.
- Inside a quoted string, only plain `@i(key)` interpolates (as in the `url`
  line above). `or` defaults are not applied inside strings, so put a macro that
  needs a default in value position (e.g. `body @i(id or 1)`), not inside a
  string.
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
- If `.r1qconfig.yaml` defines `sock`, one-shot execution posts the formatted
  response to the socket for an open terminal app.

Optional flags:

- `-env '{"KEY":"value"}'` supplies environment values for `@env(...)` macros as
  a JSON object. These are merged over `process.env` and win on duplicate keys;
  values are coerced to strings. Example:
  `r1q -r ./request -p users/get -env '{"API_TOKEN":"abc","HOST":"staging"}'`.
- `-ti <id>` tags the recorded call with a trace id so related one-shot requests
  group together in the app's history (`@h <id>`). Optional; omit it to leave the
  call untagged.

## Validation Workflow

When checking a request:

1. Identify the request root in this order: `-r <root>`, then `root` in the
   current directory's `.r1qconfig.yaml`, then `root` in
   `~/.ntee-r1quest/r1qconfig.yaml`, then the current working directory.
2. Locate the target `.nts` file, adding `.nts` if omitted.
3. Read all referenced `.ntd` files.
4. Check that all `@i(key)` macros are defined by referenced `.ntd` files, or
   carry an `or` default.
5. Check that `@env(KEY)` variables are available (ambient, via `-env`, or an
   `or` default), or clearly report they are required.
6. Check that every `@f(path)` target exists and is only used in `body`.
7. Prefer `r1q -r <root> -p <request>` for one-shot verification when the user
   wants to run the request.
