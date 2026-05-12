# ntee-r1quest

`ntee-r1quest` is a small request DSL for describing HTTP requests in `.nts`
files. Definition data lives in `.ntd` files and can be referenced from request
scripts with macros.

## Index

- [Install](#install)
  - [Setup Bun](#setup-bun)
  - [Global command install](#global-command-install)
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
  - [Execute a `.nts` file](#execute-a-nts-file)
  - [Execute a file under another root with `-r`](#execute-a-file-under-another-root-with--r)
  - [Configure a default root with `.r1qconfig.json`](#configure-a-default-root-with-r1qconfigjson)
  - [Execute raw `.nts` source with `-d`](#execute-raw-nts-source-with--d)
  - [Use `-r` and `-d` together](#use--r-and--d-together)
  - [Response display](#response-display)
- [Runtime Notes](#runtime-notes)

## Install

### Setup Bun

Before installing dependencies, make sure the Bun runtime is available in your
shell:

```bash
bun --version
```

If Bun is not installed, install it with Homebrew:

```bash
brew install bun
```

Or use the official Bun installation guide:

https://bun.sh/docs/installation

### Global command install

To install `r1q` as a local command on your machine:

```bash
# run this before installing, make sure all dependencies are installed.
bun install
```

```bash
bun run build:install
```

That installs:

```text
~/.ntee-r1quest/r1q
~/.ntee-r1quest/.r1qconfig.json
```

You must manually add this directory to your shell profile `PATH`.

For `zsh`, add this to `~/.zshrc`:

```bash
export PATH="$HOME/.ntee-r1quest:$PATH"
```

For `bash`, add this to `~/.bash_profile` or `~/.bashrc`:

```bash
export PATH="$HOME/.ntee-r1quest:$PATH"
```

Then reload your shell:

```bash
source ~/.zshrc
```

or:

```bash
source ~/.bash_profile
```

After that, you can run:

```bash
r1q sample.nts
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
const formData = await request.formData();
const file = formData.get("file");
const files = formData.getAll("files");
```

## CLI

After installing the global command, run requests with `r1q`:

```bash
r1q sample.nts
```

For development, build the local executable with Bun:

```bash
bun run build
```

That creates:

```text
./r1q
```

Supported CLI forms:

### Execute a `.nts` file

```bash
r1q sample.nts
```

If the `.nts` extension is omitted, `.nts` is added automatically:

```bash
r1q sample
```

### Execute a file under another root with `-r`

Use `-r` to override the root lookup directory. The request file is resolved
under that root.

```bash
r1q property -r ~/request/core-api
```

That looks for:

```text
~/request/core-api/property.nts
```

You can also pass the full relative path under the root:

```bash
r1q core-api/property -r ~/request
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
r1q property
```

That looks for:

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

### Execute raw `.nts` source with `-d`

Use `-d` to execute raw `.nts` source directly instead of reading a file:

```bash
r1q -d 'url "https://ntee.io"
type get

header accept, application/json
header content-type, application/json
auth bearer test-token
'
```

When `-d` is provided:

- the request file is optional and file lookup is skipped
- the root defaults to the current directory
- `-r` still works and overrides the compile root used for relative refs and file macros

### Use `-r` and `-d` together

This is useful when raw source uses `ref ./file.ntd` or `@f(...)` and you want
those relative paths to resolve from a specific directory.

```bash
r1q -r ~/request/test/data -d 'ref ./user.ntd
url "https://ntee.io"
type get

header accept, application/json
header content-type, application/json
auth bearer @i(token)
'
```

### Response display

The CLI renders:

- a pending indicator while the request is running
- a `Response` section with status
- a `Headers` section
- a `Body` section

If the request fails, the CLI renders an `Error` section in the terminal.

## Runtime Notes

`execute(scopeObject)` sends requests based on `content-type`:

- `application/json` sends the body as JSON-compatible data.
- `text/plain` requires a string body.
- `multipart/form-data` converts the body object into `FormData`.

File values are only allowed with `multipart/form-data`.

```ts
import { compileFile, CompileSourceType } from "./src/compiler/semantics.ts";
import { execute } from "./src/runtime/request.ts";

const scopeObject = compileFile("test/data/post.nts", CompileSourceType.File);
const response = await execute(scopeObject);
```
