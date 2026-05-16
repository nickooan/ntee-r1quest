# ntee-r1quest

`ntee-r1quest` is a small request DSL for describing HTTP requests in `.nts`
files. Definition data lives in `.ntd` files and can be referenced from request
scripts with macros.

## Terminal Preview

```text
>_ Ntee R1quest
ver: 0.1.0

>_ Spend 123 ms,

--------------- Response of get /users ---------------

200 OK

--------------- Headers ---------------

content-type: application/json

--------------- Body ---------------

{
  "id": 1,
  "name": "r1quest"
}

--------------- End of get /users ---------------

@default:sample
```

## Index

- [Install](#install)
  - [Setup Node.js](#setup-nodejs)
  - [Development install](#development-install)
- [File Types](#file-types)
  - [`.nts`](#nts)
  - [`.ntd`](#ntd)
- [Request Syntax](#request-syntax)
  - [References](#references)
  - [URL](#url)
  - [Method](#method)
  - [Authorization](#authorization)
  - [Headers](#headers)
- [Macros](#macros)
  - [`@i(key)`](#ikey)
  - [`@env(KEY)`](#envkey)
  - [`@f(path)`](#fpath)
- [Body Examples](#body-examples)
  - [JSON Object](#json-object)
  - [JSON Array](#json-array)
  - [Plain Text](#plain-text)
  - [Multipart Form](#multipart-form)
- [CLI](#cli)
  - [Open the terminal UI](#open-the-terminal-ui)
  - [Set another root with `-r`](#set-another-root-with--r)
  - [Configure a default root with `.r1qconfig.json`](#configure-a-default-root-with-r1qconfigjson)
  - [Search response output](#search-response-output)
  - [Response display](#response-display)
- [Runtime Notes](#runtime-notes)

## Install

### Setup Node.js

Before installing dependencies, make sure the Node.js runtime is available in your
shell:

```bash
node --version
```

This project uses npm for dependencies and builds TypeScript to JavaScript before
running under Node.js.

### Development install

```bash
npm install
```

```bash
npm run build
```

The compiled CLI entrypoint is `dist/index.js`. The package exposes this
entrypoint as the `r1q` command.

For local development, link the package after building:

```bash
npm link
```

Then run:

```bash
r1q
```

You can also run the compiled entrypoint directly:

```bash
npm run start
```

After the package is published, users can run it with `npx`:

```bash
npx ntee-r1quest
```

## File Types

### `.nts`

`.nts` files describe one request: URL, method, headers, authorization, and body.

```nts
ref ./user.ntd

url "https://ntee.io"
type post

header content-type, application/json
auth bearer @i(token)

body {
  name: "r1quest"
  spid: @i(name)
  description: my age is @i(age)
  off: @i(off)
  arr: @i(arr)
}
```

### `.ntd`

`.ntd` files store reusable definition data. A request script can load them with
`ref`.

```ntd
name: macro-name
token: test-token
age: 2
off: false
arr: ["macro", 2, false]
```

`.ntd` values can also read from environment variables with `@env(KEY)`.

```ntd
token: @env(API_TOKEN)
base-url: @env(API_BASE_URL)
```

When a definition file is built, `@env(KEY)` resolves from `process.env.KEY`.
If the environment variable is missing, compilation throws:

```text
Undefined env macro: @env(KEY)
```

Values support strings, numbers, booleans, null, arrays, and objects. Unquoted
bare values default to strings unless they are `true`, `false`, `null`, or a
number.

```ntd
trace-token: asdgjklasjdklf
off: false
off2: "false"
age: 2
arr: [name, weight, "1", true]
content: {
  sub-content: xyz
}
```

## Request Syntax

### References

`ref` imports `.ntd` data before the request is compiled.

```nts
ref ./user.ntd
ref ../shared/auth.ntd
```

References must appear before request statements.

### URL

```nts
url "https://ntee.io"
```

### Method

Use `type` for the HTTP method.

```nts
type get
type post
type put
type delete
type patch
```

Any HTTP token is accepted, so standard methods such as `head`, `options`,
`trace`, and `connect` are valid too.

### Authorization

Use `auth` or `authorization`.

```nts
auth bearer test-token
authorization basic username-password-token
```

The auth line compiles into an `authorization` header.

With definition data:

```ntd
token: test-token
```

```nts
ref ./user.ntd
auth bearer @i(token)
```

Compiles to:

```ts
headers: {
  authorization: "bearer test-token"
}
```

### Headers

Headers use this form:

```nts
header content-type, application/json
header accept, application/json
header trace-token, "abc"
```

Header names are normalized to lowercase during compile.

Header values can be quoted strings, unquoted strings, numbers, booleans, null,
or `@i(...)` macros.

```nts
ref ./user.ntd

header x-token, @i(token)
header retry-count, 2
header debug, false
```

`@f(...)` is not valid in headers.

## Macros

### `@i(key)`

Reads a value from referenced `.ntd` definition data.

```ntd
token: test-token
age: 2
off: false
```

```nts
auth bearer @i(token)

body {
  age: @i(age)
  off: @i(off)
  description: my age is @i(age)
}
```

Standalone `@i(...)` preserves the original value type:

```nts
body {
  age: @i(age)
}
```

Compiles to:

```ts
body: {
  age: 2
}
```

Mixed into a string or bare string, `@i(...)` interpolates as text:

```nts
body {
  description: my age is @i(age)
}
```

Compiles to:

```ts
body: {
  description: "my age is 2"
}
```

### `@env(KEY)`

Reads a value from an environment variable. This macro is only available in
`.ntd` definition files.

```ntd
token: @env(API_TOKEN)
base-url: @env(API_BASE_URL)
```

When the `.ntd` file is built, `@env(KEY)` resolves from `process.env.KEY`.
If the environment variable is missing, compilation throws:

```text
Undefined env macro: @env(KEY)
```

### `@f(path)`

Creates a file value from a path. It is only valid in body object values.

```nts
body {
  file: @f(upload.txt)
}
```

The compiled value is always an array:

```ts
body: {
  file: [Blob]
}
```

Multiple files can be assigned with an array:

```nts
body {
  files: [@f(upload.txt), @f(upload2.txt)]
}
```

Compiles to:

```ts
body: {
  files: [Blob, Blob]
}
```

File paths resolve relative to the `.nts` file when using `compileFile`.

`@f(...)` cannot be used directly as the whole body:

```nts
body @f(upload.txt) // invalid
```

`@f(...)` is intended for `multipart/form-data` requests. Runtime throws if a
file value is used with JSON or text requests.

## Body Examples

### JSON Object

```nts
header content-type, application/json

body {
  name: "r1quest"
  age: 2
  off: false
  tags: ["api", "test"]
  nested: {
    value: xyz
  }
}
```

### JSON Array

```nts
header content-type, application/json

body [{ name: a }, { name: b }]
```

```nts
header content-type, application/json

body [1, 2, 3]
```

### Plain Text

Plain text bodies must be quoted.

```nts
header content-type, text/plain

body "plain text"
```

Multiline text is supported.

```nts
header content-type, text/plain

body "hello
new line
another line
"
```

For longer multiline content, keep the body wrapped by one opening quote and one
closing quote:

```nts
header content-type, text/plain

body "
hello, asdfa
new line
new line
     new line
"
```

### Multipart Form

Use `multipart/form-data` with an object body.

```nts
header content-type, multipart/form-data

body {
  name: r1quest
  age: 2
  enabled: true
}
```

File upload:

```nts
header content-type, multipart/form-data

body {
  file: @f(upload.txt)
}
```

Multiple files under one field name:

```nts
header content-type, multipart/form-data

body {
  files: [@f(upload.txt), @f(upload2.txt)]
}
```

Server-side `FormData` can read these like browser uploads:

```ts
const formData = await request.formData()
const file = formData.get("file")
const files = formData.getAll("files")
```

## CLI

For development, compile the TypeScript source with npm:

```bash
npm run build
```

That creates:

```text
./dist
```

Supported CLI forms:

### Open the terminal UI

```bash
r1q
```

For local development, run `npm run build` and `npm link` first. Without linking,
use `npm run start`.

After publishing, users can also run the package without installing it globally:

```bash
npx ntee-r1quest
```

Or install it globally:

```bash
npm install -g ntee-r1quest
r1q
```

The app opens a command line at the bottom of the terminal. Type a request file
path and press enter to execute it:

```text
@default:sample
```

If the `.nts` extension is omitted, `.nts` is added automatically. The app stays
open after each request. The default prompt is `@default:`. Use `control-c` to
quit.

### Set another root with `-r`

Use `-r` to override the root lookup directory.

```bash
r1q -r ~/request/core-api
```

Then type the request path inside the app:

```text
@default:property
```

That executes:

```text
~/request/core-api/property.nts
```

You can also type a nested path under the root:

```text
@default:core-api/property
```

That looks for:

```text
~/request/core-api/property.nts
```

### Configure a default root with `.r1qconfig.json`

If you often run requests from the same root, create a config file with a
`root` attribute.

Current directory config:

```json
{
  "root": "~/request/core-api"
}
```

Save it as:

```text
./.r1qconfig.json
```

Then you can run:

```bash
r1q
```

Then type:

```text
@default:property
```

That executes:

```text
~/request/core-api/property.nts
```

If `./.r1qconfig.json` does not exist, the CLI falls back to:

```text
~/.ntee-r1quest/.r1qconfig.json
```

Root resolution precedence is:

1. `-r`
2. `./.r1qconfig.json`
3. `~/.ntee-r1quest/.r1qconfig.json`
4. current working directory

### Search response output

From the default prompt, type `@search` and press enter to switch into search
mode:

```text
@default:@search
```

The prompt changes to `@search:`. Type a search query and press enter to
highlight matching text in the rendered response:

```text
@search:content-type
```

Search queries are treated as regular expressions when valid. Invalid regular
expressions fall back to plain text search. In search mode, use up and down
arrows to move between matches. Use left, right, page up, page down, home, and
end to scroll the response view.

To return to request input mode, type `@default` or `@q` and press enter:

```text
@search:@default
```

### Response display

The CLI renders:

- a fixed terminal view with a command line at the bottom
- a pending indicator while the request is running
- a `Response` section with status
- a `Headers` section
- a `Body` section

Use arrow keys to scroll the response view horizontally and vertically. If the
request fails with an HTTP response, the response status, headers, and body are
rendered. Other failures render an `Error` section.

## Runtime Notes

`execute(scopeObject)` sends requests based on `content-type`:

- `application/json` sends the body as JSON-compatible data.
- `text/plain` requires a string body.
- `multipart/form-data` converts the body object into `FormData`.

File values are only allowed with `multipart/form-data`.

```ts
import { compileFile, CompileSourceType } from "./src/compiler/semantics.ts"
import { execute } from "./src/runtime/request.ts"

const scopeObject = compileFile("test/data/post.nts", CompileSourceType.File)
const response = await execute(scopeObject)
```
