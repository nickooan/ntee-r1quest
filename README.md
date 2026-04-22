# ntee-r1quest

`ntee-r1quest` is a small request DSL for describing HTTP requests in `.nts`
files. Definition data lives in `.ntd` files and can be referenced from request
scripts with macros.

## Install

```bash
bun install
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

## Runtime Notes

`execute(scopeObject)` sends requests based on `content-type`:

- `application/json` sends the body as JSON-compatible data.
- `text/plain` requires a string body.
- `multipart/form-data` converts the body object into `FormData`.

File values are only allowed with `multipart/form-data`.

```ts
import { compileFile } from "./src/compiler/semantics.ts";
import { execute } from "./src/runtime/request.ts";

const scopeObject = compileFile("test/data/post.nts");
const response = await execute(scopeObject);
```
