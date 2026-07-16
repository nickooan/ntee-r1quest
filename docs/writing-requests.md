# Writing requests

The complete reference for authoring a request collection: `.ntd` data files,
`.nts` request files, joint chains, macros, the bundled examples, and GraphQL.
For running requests, see the [README](../README.md) and the
[terminal app guide](terminal-app.md).

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

Supported value types: string, number, boolean, null, array, object, and the
`@env(KEY)` / `@env(KEY or <default>)` environment macro — standalone or
embedded inside a bare value (e.g. `path: /todos/@env(id or 1)`).

Rules and cautions:

- Wrap URLs in double quotes. Unquoted `http://` or `https://` contains `//`,
  which starts a comment.

  ```ntd
  host: "https://httpbin.org"   // good
  host: https://httpbin.org     // problematic — // starts a comment
  ```

- Bare values default to strings unless they are `true`, `false`, `null`, or a
  number.
- Keys may be bare identifiers such as `content-type`, or quoted strings when
  needed.
- `.ntd` files can use `@env(KEY)`, but cannot use `@i(...)` or `@f(...)`.
- `@env(...)` may stand alone as a value **or** be embedded inside a bare
  (unquoted) value, where it resolves and is spliced into the surrounding
  text, e.g. `path: /todos/@env(id or 1)` → `/todos/1`. Embedding works only
  in bare values — inside a quoted string the `@env(...)` text stays literal.
- Comments start with `//`.

## `.nts` Request Files

`.nts` files declare one HTTP request.

```nts
ref ../data/example.ntd

url "@i(host)@i(path)"
type get

header accept, @i(content-type)
header content-type, @i(content-type)
```

Supported declarations:

| Declaration                             | Notes                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ref ./path/to/file.ntd`                | Must appear before other statements; path relative to the `.nts` file. Multiple refs allowed. |
| `url "https://example.com/path"`        | Quoted string; `@i(...)` interpolates inside it.                                              |
| `type get`                              | HTTP method: `get`, `post`, `put`, `patch`, `delete`, …                                       |
| `header content-type, application/json` | Keys normalized to lowercase; macro values must resolve to primitives.                        |
| `auth bearer <token>`                   | Or `authorization basic <credentials>`.                                                       |
| `body ...`                              | JSON object/array, plain or multiline text, or multipart (below).                             |

Body forms:

```nts
// JSON object
body {
  name: "r1quest"
  enabled: true
  tags: ["api", "example"]
}

// JSON array
body [
  { name: "first" },
  { name: "second" }
]

// Plain text (multiline strings allowed)
body "plain text body"
```

Multipart file upload:

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

- `ref` and `@f(...)` paths are resolved relative to the `.nts` file.
- `@env(...)` cannot be used in `.nts` files — it is a compile error
  (`Unsupported macro operator: env`). Read env values in a `.ntd` and
  reference them with `@i(...)`. See [`@env(KEY)`](#envkey).
- `@f(...)` is only valid inside request body values (not headers, not auth,
  not the entire body by itself) and takes a literal file path, never a macro.
- Comments start with `//`.

## Joint Chain Files (`.joint.nts`)

A joint file chains existing `.nts` requests into one run: each step executes
in order, values picked from a response feed the next request, every call is
recorded to history under one trace id, and **only the final response is
printed**. Declaring `@joint(...)` makes the file a chain — it can no longer
contain `url`, `type`, `header`, `auth`, or `body` statements. The
`.joint.nts` suffix is a naming convention, not a requirement; any `.nts` file
with a `@joint(...)` declaration is a chain.

The shipped example (`example/request/queries/query-user-post.joint.nts`):

```nts
ref ../../data/example.ntd

@joint('example-user-post-chain')

-> @pick(content: @i(content-type)) // optional leading pick: context values only
-> @run(query-user)
-> @pick(userId: data.user.id)
-> @run(query-user-posts)
-> @pick(postId: data.user.posts.data[0].id)
-> @run(query-post)
```

Run it like any one-shot request:

```bash
r1q -r ./example -p request/queries/query-user-post.joint
```

The output is the final step's response followed by a summary line with the
trace id — inspect the whole chain, including intermediate steps, with
`@h example-user-post-chain` in the terminal app.

**Structure**

- `ref` lines come first, then `@joint(<trace-id>)`, then one or more steps.
- The trace id may be single- or double-quoted, or omitted: `@joint()`
  generates one (`joint-<timestamp>-<token>`). The CLI `-ti` flag takes
  precedence over the declared id.
- A step is `-> @run(<path>)`, optionally preceded by `-> @pick(...)`. The
  pick binds to the run that follows it, so a trailing `@pick` with no `@run`
  is a parse error.
- `@run` paths resolve relative to the joint file (`.nts` optional), so
  `@run(query-user)` and `@run(../folder-2/create-post)` both work.

**Picking values**

`@pick(key: <source>, ...)` merges values into the chain env, which later
steps read through the ordinary `@env(...)` mechanism in their `ref`'d `.ntd`
files. Two kinds of source:

- a **json path** into the previous step's response body — dot segments plus
  `[n]` indexes, e.g. `data.user.posts.data[0].id`;
- an **`@i(key)` macro** (with optional `or` default) reading the joint file's
  own `ref`'d context.

Values accumulate across steps (a key picked at step 1 is still available at
step 3); later picks win on duplicate keys, and picked values override
same-named keys from `-env`. Non-string values are JSON-stringified, matching
`-env` coercion. The first step's pick runs before any response exists, so it
may only use `@i(...)` sources.

For the chain above, `example/graphql/query-user-posts.ntd` reads the picked
value with a default so the request still works standalone:

```ntd
variables: {
  id: @env(userId or "1")
  page: 1
  limit: 5
}
```

**The rule of `@joint`**

Every step must be an `application/json` request returning a JSON response
(a body-less response such as `204 No Content` is allowed). A joint file
cannot `@run` another joint file. Violations stop the chain before the
offending request is sent.

**Failure behavior**

The chain stops at the first failing step — compile error, non-2xx response,
non-JSON content, or an unresolvable json path. The run prints
`Joint step N/M (<target>) failed.` plus the failing response or error and
exits non-zero. Steps that already ran are in history under the trace id.

**Terminal app behavior**

Joint files also run directly inside the terminal app — select or type the
joint file's path in `@query` mode and press Enter like any request. The
results pane shows only the final response, with the trace id and a
`Joint chain: N steps completed` footer; every step is in history under the
trace id. If a step fails with an HTTP response, that response is shown with a
`Joint step N/M (<target>) failed.` banner.

When a chain runs from the CLI (`-p`) while the app is open, intermediate
steps are persisted to history but do not touch the results pane; only the
chain's final response (or a failing step) is displayed.

## Macros

At a glance — which macro is allowed where:

| Macro       | `.ntd` files | `.nts` files          | Defaults (`or`)   |
| ----------- | ------------ | --------------------- | ----------------- |
| `@i(key)`   | ❌ no        | ✅ yes                | ✅ value position |
| `@env(KEY)` | ✅ yes       | ❌ no (compile error) | ✅ value position |
| `@f(path)`  | ❌ no        | ✅ body values only   | —                 |

`or` defaults apply in **value position** (body, header, auth, `.ntd` values),
not inside quoted strings — there, only plain `@i(key)` interpolates.

### `@i(key)`

Reads a value from referenced `.ntd` definition data. Use it in `.nts` files:
quoted URL strings, authorization credentials, header values, body values, and
plain text/bare string interpolation.

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

**Defaults.** Use `@i(key or <value>)` to fall back when the key is missing
from the referenced `.ntd` files. The default must be an immediate string,
number, or boolean — never another macro:

```nts
header accept, @i(accept or "application/json")

body {
  age: @i(age or 20)
  deleted: @i(deleted or true)
}
```

Defaults apply in **value position** (headers, auth, body). They do **not**
apply inside a quoted string — including the `url` value — where only plain
`@i(key)` interpolates. Put a macro that needs a default in value position, or
resolve it in the `.ntd` (e.g. `id: @env(ID or 1)`) and reference it plainly
with `@i(id)`.

### `@env(KEY)`

Reads an environment variable. Use it only in `.ntd` files:

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

> **`@env` is `.ntd`-only.** Writing `@env(...)` anywhere in a `.nts` file — a
> value, a header, or inside a string — is a **compile error**
> (`Unsupported macro operator: env`), not literal text.

**Defaults.** Use `@env(KEY or <value>)` to fall back when the variable is
unset. The default must be an immediate string, number, or boolean:

```ntd
port: @env(PORT or 8080)
token: @env(API_TOKEN or "dev-token")
debug: @env(DEBUG or false)
```

If the variable is unset and there is no default, compilation throws an error.
To supply values at run time without exporting them, pass `-env` on the CLI:
`-env '{"API_TOKEN":"abc"}'` (values merge over `process.env` and win on
duplicate keys).

**Embedding in bare values.** `@env(...)` can also appear **inside** a bare
(unquoted) value. It resolves and is spliced into the surrounding text, so you
can build paths and identifiers from environment variables:

```ntd
path: /todos/@env(TODO_ID or 1)
path-between: /todos/@env(TODO_ID or 1)/comments
```

With `TODO_ID` unset these compile to `/todos/1` and `/todos/1/comments`; with
`TODO_ID=42` they become `/todos/42` and `/todos/42/comments`. A standalone
`@env(...)` keeps its native type (e.g. a number default stays a number),
while an embedded one is stringified into the value.

> Embedding works only in **bare** values. Inside a **quoted** string the
> `@env(...)` text is treated as literal characters — `path: "/todos/@env(id)"`
> stores `/todos/@env(id)` verbatim. Likewise a literal `@` that is not a
> valid `@env(...)` macro (e.g. `/users/@me`) is preserved as-is.

### `@f(path)`

Loads a local file as a request body value. Use it only in `.nts` body values:

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
npm run build:ts
npm run start        # runs the compiled app with example/request as the root
```

Try `example` or `example-upload` in `@query`. The repo includes:

- **JSONPlaceholder requests** — `example/data/*.ntd`,
  `example/request/example.nts`, `example/request/folder-1/*` (create/get
  post), `example/request/folder-2/*` (update/delete post).
- **A multipart upload** against httpbin — `example/request/example-upload.nts`
  with `example/data/example-upload.ntd` and `example/files/example.txt`.
- **GraphQLZero examples** that split operation text and variables into
  `example/graphql/*.ntd`, executed by resolver requests under
  `example/request/queries/` and `example/request/mutations/`.
- **A joint chain** — `example/request/queries/query-user-post.joint.nts`.

Try one without opening the terminal UI:

```bash
r1q -r ./example -p request/queries/query-post.nts
r1q -r ./example -p request/mutations/mutation-create-post.nts
```

## GraphQL Requests

GraphQL requests work well when `.ntd` files hold the operation and variables,
while `.nts` files hold the HTTP request.

Query definition:

```ntd
query GetPost($id: ID!) {
  post(id: $id) {
    id
    title
    body
  }
}
variables: {
  id: "1"
}
```

Mutation definition:

```ntd
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    id
    title
  }
}
variables: {
  input: {
    title: "R1Quest GraphQL example"
    body: "Created from a GraphQL mutation example."
  }
}
```

Resolver request:

```nts
ref ../../graphql/query-post.ntd

url "https://graphqlzero.almansi.me/api"
type post

header accept, application/json
header content-type, application/json

body {
  query: @i(query)
  variables: @i(variables)
}
```

For mutations, send the operation with `@i(mutation)`:

```nts
body {
  query: @i(mutation)
  variables: @i(variables)
}
```

`.nts` files may reference multiple `.ntd` files. This is useful when shared
auth, host, or token values already live in another definition file:

```nts
ref ../../data/auth.ntd
ref ../../graphql/query-private-user.ntd

url "https://api.example.com/graphql"
type post

header accept, application/json
header content-type, application/json
auth bearer @i(token)

body {
  query: @i(query)
  variables: @i(variables)
}
```

When multiple refs define the same key, later refs overwrite earlier refs.
