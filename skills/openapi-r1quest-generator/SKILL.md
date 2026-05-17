---
name: openapi-r1quest-generator
description: Generate ntee-r1quest request projects from Swagger/OpenAPI v3 YAML or JSON files. Use when asked to scan an OpenAPI spec and create .ntd data files plus .nts request files organized by project, HTTP method, and operation name.
---

# OpenAPI R1Quest Generator

Use this skill to convert a Swagger/OpenAPI v3 spec into an `ntee-r1quest`
request project.

## Inputs

Ask for any missing required input:

- OpenAPI spec path, usually `.yaml`, `.yml`, or `.json`
- Output directory
- Project name

Optional input:

- Environment variable names for auth tokens
- Which server URL to use when the OpenAPI spec has multiple `servers`
- Whether to include example request bodies when schemas/examples are available

## Output Layout

Generate one project directory under the requested output directory:

```text
<output-dir>/<project-name>/
  data/
    common.ntd
    auth.ntd
    <operation-name>.ntd
  get-property.nts
  create-property.nts
  update-property.nts
  delete-property.nts
```

Rules:

- Put shared values in `data/common.ntd`.
- Put auth-related values in `data/auth.ntd` when auth exists.
- Put operation-specific body/query/header examples in `data/<operation-name>.ntd`
  when the operation needs reusable data.
- Put `.nts` request files directly under `<project-name>/`.
- Name request files as `<method>-<operation-name>.nts`.
- Normalize operation names to lowercase kebab-case.
- Prefer `operationId` for operation names.
- If `operationId` is missing, derive the name from HTTP method plus path.

Example:

```text
property-api/
  data/
    common.ntd
    auth.ntd
    create-property.ntd
  get-property.nts
  create-property.nts
```

## Read And Normalize The OpenAPI Spec

Parse the OpenAPI file with a structured parser. Do not parse YAML with ad hoc
string splitting.

Extract:

- `servers`
- `paths`
- path-level parameters
- operation-level parameters
- request headers
- request bodies
- security requirements
- response content types when useful for `accept`

Use the first `servers[0].url` by default unless the user requested another
server.

If the server URL contains variables, create values in `data/common.ntd` and
document the selected defaults.

## Generate `.ntd` Files

`.ntd` files store reusable data for `@i(...)` macros.

Always quote URLs because `//` starts comments:

```ntd
host: "https://api.example.com"
content-type: application/json
accept: application/json
```

For auth tokens, prefer environment macros:

```ntd
token: @env(API_TOKEN)
```

For path/query/body examples, generate realistic placeholder data from OpenAPI
examples, defaults, enums, schema types, and property names.

Example:

```ntd
property-id: property-123
page: 1
limit: 20
property: {
  name: "Example property"
  enabled: true
}
```

`.ntd` constraints:

- Use `@env(KEY)` only in `.ntd` files.
- Do not use `@i(...)` in `.ntd` files.
- Do not use `@f(...)` in `.ntd` files.
- Quote strings containing `://`, `//`, commas, brackets, or braces.

## Generate `.nts` Files

Each `.nts` file declares one HTTP request.

Basic shape:

```nts
ref ./data/common.ntd

url "@i(host)/properties/@i(property-id)"
type get

header accept, @i(accept)
```

With auth:

```nts
ref ./data/common.ntd
ref ./data/auth.ntd

url "@i(host)/properties"
type get

header accept, @i(accept)
auth bearer @i(token)
```

With JSON body:

```nts
ref ./data/common.ntd
ref ./data/auth.ntd
ref ./data/create-property.ntd

url "@i(host)/properties"
type post

header accept, @i(accept)
header content-type, @i(content-type)
auth bearer @i(token)

body @i(property)
```

With multipart file upload:

```nts
ref ./data/common.ntd
ref ./data/auth.ntd

url "@i(host)/files"
type post

header content-type, multipart/form-data
auth bearer @i(token)

body {
  file: @f(./files/example.txt)
}
```

`.nts` constraints:

- Put `ref` statements before other statements.
- Resolve `ref` paths relative to the `.nts` file.
- Use quoted strings for `url`.
- Use `@i(...)` for host, path parameters, query parameter values, header values,
  auth values, and body values.
- Use `@f(...)` only inside body values.
- Do not use `@f(...)` in headers or auth.

## URL And Parameters

Convert OpenAPI path templates:

```text
/properties/{propertyId}
```

to:

```nts
url "@i(host)/properties/@i(property-id)"
```

For query parameters, include them in the URL:

```nts
url "@i(host)/properties?page=@i(page)&limit=@i(limit)"
```

Put corresponding values in an `.ntd` file:

```ntd
page: 1
limit: 20
```

## Headers And Content Types

Choose `accept` from response content types. Prefer `application/json` when
available.

Choose `content-type` from request body content types. Prefer:

1. `application/json`
2. `multipart/form-data`
3. the first available OpenAPI request content type

For JSON bodies:

```nts
header content-type, application/json
```

For multipart bodies:

```nts
header content-type, multipart/form-data
```

## Auth Mapping

Map OpenAPI security schemes:

- HTTP bearer -> `auth bearer @i(token)`
- HTTP basic -> `auth basic @i(credentials)`
- API key header -> `header <name>, @i(api-key)`
- API key query -> append `?<name>=@i(api-key)` or `&<name>=@i(api-key)`

Generate `data/auth.ntd` with environment macros:

```ntd
token: @env(API_TOKEN)
api-key: @env(API_KEY)
credentials: @env(API_BASIC_CREDENTIALS)
```

Use clear environment variable names derived from the project name and security
scheme when possible.

## Operation Naming

Normalize names:

- `getProperty` -> `get-property`
- `Create Property` -> `create-property`
- `GET /properties/{propertyId}` -> `get-property-by-property-id`

Avoid duplicate file names. If two operations normalize to the same name, append
a short path-derived suffix.

## Validation

After generation:

1. Run the project formatter if available.
2. Compile at least one generated `.nts` file with the local `ntee-r1quest`
   compiler when available.
3. Check that every `ref` path exists.
4. Check that every `@i(key)` is defined by one of the referenced `.ntd` files.
5. Check that every `@f(path)` points to an existing example file, or clearly
   mark the file as a placeholder that the user must provide.

Report:

- generated project path
- number of `.nts` files
- number of `.ntd` files
- any skipped operations and why
- validation commands and results
