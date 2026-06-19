---
name: graphql-schema-r1quest-generator
description: Generate a ntee-r1quest GraphQL request project from a GraphQL schema file. Use when the user provides a schema path and asks to create or generate gql/graphql requests into an output directory or current CLI directory.
argument-hint: "<schema-path> [output-dir]"
---

# GraphQL Schema R1Quest Generator

Use this skill when a user asks to generate `gql` or `graphql` requests from a
GraphQL schema file into a `ntee-r1quest` project.

Example requests:

- `create graphql from schema ./schema.graphql to ./example`
- `generate gql from schema /xxx/schema to my-api`
- `create graphql from schema ./schema.json`

If the output directory is not specified, use the current CLI working directory.

## Inputs

Required:

- GraphQL schema path: `.graphql`, `.gql`, `.json`, or introspection JSON.

Optional:

- Output directory.
- GraphQL endpoint URL.
- Auth style: bearer token, cookie, API key header, or no auth.
- Which operations to generate when the schema is large.

Ask for endpoint/auth details only when needed. If missing, create clear
placeholders in `data/common.ntd` and `data/auth.ntd`.

## Output Layout

Generate this shape under the target directory:

```text
<output-dir>/
  data/
    common.ntd
    auth.ntd
  graphql/
    query-<operation>.ntd
    mutation-<operation>.ntd
  request/
    queries/
      query-<operation>.nts
    mutations/
      mutation-<operation>.nts
```

## Shared Data

`data/common.ntd`:

```ntd
graphql-host: "https://api.example.com/graphql"
accept: application/json
content-type: application/json
```

`data/auth.ntd`, only when auth is needed:

```ntd
token: @env(API_TOKEN)
cookie: @env(API_COOKIE)
api-key: @env(API_KEY)
```

Rules:

- Quote endpoint URLs because `//` starts comments.
- Prefer `@env(...)` for secrets, but only inside `.ntd` files. Never put
  `@env(...)` in a `.nts` file — it is a compile error; reference env values from
  `.nts` with `@i(...)`.
- Do not duplicate token, cookie, or API key values in operation `.ntd` files.

## Schema Support

Parse the schema with a structured GraphQL parser or introspection parser when
available. Do not parse real schemas with ad hoc line splitting.

Support these schema definitions:

- `schema { query: Query mutation: Mutation }`
- `type Query { ... }`
- `type Mutation { ... }`
- object `type Xxx { ... }`
- `input XxxInput { ... }`
- `enum Xxx { ... }`
- `interface Xxx { ... }`
- `union Xxx = A | B`
- custom `scalar Xxx`

Do not generate requests for every `type` directly. Use object, input, enum,
interface, union, and scalar definitions to build valid selections and variables
for root fields on `Query` and `Mutation`.

If there is no explicit `schema { ... }`, assume root operation types are named
`Query` and `Mutation`.

Skip `Subscription` by default unless the user explicitly asks; R1Quest request
files are HTTP request oriented.

## Operation `.ntd` Files

Use R1Quest GraphQL shorthand plus `variables`.

Query:

```ntd
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
    email
  }
}
variables: {
  id: "example-id"
}
```

Mutation:

```ntd
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
  }
}
variables: {
  input: {
    name: "Example User"
  }
}
```

Rules:

- Generate one `.ntd` file per root operation field.
- Use lowercase kebab-case file names.
- Always include `variables: {}` even when empty.
- Keep selections shallow: scalar fields plus one level of useful nested
  `id`/`name` fields.
- Avoid recursive cycles.

## Request `.nts` Files

Reference shared data first and operation data last. Later refs overwrite
earlier refs.

Query request:

```nts
ref ../../data/common.ntd
ref ../../data/auth.ntd
ref ../../graphql/query-get-user.ntd

url "@i(graphql-host)"
type post

header accept, @i(accept)
header content-type, @i(content-type)
auth bearer @i(token)

body {
  query: @i(query)
  variables: @i(variables)
}
```

Mutation request:

```nts
ref ../../data/common.ntd
ref ../../data/auth.ntd
ref ../../graphql/mutation-create-user.ntd

url "@i(graphql-host)"
type post

header accept, @i(accept)
header content-type, @i(content-type)
auth bearer @i(token)

body {
  query: @i(mutation)
  variables: @i(variables)
}
```

Auth variants:

- Bearer: `auth bearer @i(token)`
- Cookie: `header cookie, @i(cookie)`
- API key header: `header x-api-key, @i(api-key)` or the documented header name
- No auth: omit `data/auth.ntd` refs and auth/header lines

## Generation Rules

Root fields:

- Generate `Query` root fields into `graphql/query-*.ntd` and
  `request/queries/query-*.nts`.
- Generate `Mutation` root fields into `graphql/mutation-*.ntd` and
  `request/mutations/mutation-*.nts`.

Selection rules:

- Scalar return: request the field directly.
- Object return: select useful scalar fields such as `id`, `name`, `title`,
  `email`, status fields, and timestamps.
- List/connection return: include common pagination args and select
  `nodes`/`edges.node` when the schema uses connection naming.
- Interface/union return: use inline fragments for a small set of concrete
  types when possible.

Variable examples:

- `String`, `ID`: `"example"`
- `Int`: `1`
- `Float`: `1.0`
- `Boolean`: `true`
- enum: first enum value
- input object: recursively fill required fields and a few useful optional
  fields
- list: one example item
- custom scalar: use a string placeholder unless the scalar name implies a
  better value, such as date or URL.

## Validation

After generation:

1. Check every `ref` path exists.
2. Check every `@i(...)` key is defined by referenced `.ntd` files.
3. Compile every generated `.nts` file.
4. If endpoint and network access are available, run one query:

```bash
r1q -r <output-dir> -p request/queries/query-<operation>.nts
```

Report output directory, generated file counts, skipped root fields, and
validation results.
