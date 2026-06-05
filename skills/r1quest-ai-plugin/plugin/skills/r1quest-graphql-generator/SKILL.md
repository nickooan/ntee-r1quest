---
name: r1quest-graphql-generator
description: Generate GraphQL examples and request actions using ntee-r1quest .ntd and .nts files. Use when asked to create, convert, review, or run GraphQL queries or mutations in a R1Quest project.
argument-hint: "<graphql-endpoint> <operation-name>"
---

# R1Quest GraphQL Generator

Use this skill to create GraphQL request examples for `ntee-r1quest` projects.
Prefer a clean split:

- `.ntd` stores GraphQL operation text, variables, and reusable data.
- `.nts` stores endpoint, HTTP method, headers, refs, and request body wiring.

## File Layout

Use existing project layout when present. If creating new examples, prefer:

```text
graphql/
  query-post.ntd
  query-user.ntd
  mutation-create-post.ntd
request/
  queries/
    query-post.nts
    query-user.nts
  mutations/
    mutation-create-post.nts
```

Resolver `.nts` files should reference GraphQL `.ntd` files with paths relative
to the `.nts` file.

## `.ntd` Pattern

For queries:

```ntd
query GetPost($id: ID!) {
  post(id: $id) {
    id
    title
  }
}
variables: {
  id: "1"
}
```

For mutations:

```ntd
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    id
    title
  }
}
variables: {
  input: {
    title: "Example title"
  }
}
```

Rules:

- Use top-level `query ... { ... }` for query operations and
  `mutation ... { ... }` for mutation operations.
- Quoted `query: "..."` and `mutation: "..."` entries are still valid when
  explicit string values are preferred.
- Put variables in a `variables:` object, even when empty: `variables: {}`.
- Use GraphQL variables instead of interpolating values into operation text.
- Do not use `@i(...)` or `@f(...)` inside `.ntd` files.
- Use `@env(KEY)` only for environment values needed in variables or auth data.

## Multiple References

`.nts` files support multiple `ref` lines. Use this when the operation needs
shared data, auth, or environment-backed values in addition to the GraphQL
operation file.

```nts
ref ../../data/auth.ntd
ref ../../data/graphql-common.ntd
ref ../../graphql/query-post.ntd
```

Rules:

- Put all `ref` statements before other statements.
- Later refs overwrite earlier refs when they define the same key.
- Order shared defaults first, then auth or environment data, then the
  operation-specific GraphQL `.ntd` file.
- If a token is already defined in a project file such as `data/auth.ntd`, reuse
  it instead of duplicating it in the GraphQL operation file.

Example auth data:

```ntd
token: @env(API_TOKEN)
```

Example resolver using the token:

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

## `.nts` Pattern

For query operations:

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

For mutation operations:

```nts
ref ../../graphql/mutation-create-post.ntd

url "https://graphqlzero.almansi.me/api"
type post

header accept, application/json
header content-type, application/json

body {
  query: @i(mutation)
  variables: @i(variables)
}
```

Rules:

- GraphQL requests should use `type post`.
- Always set `header content-type, application/json`.
- Use `header accept, application/json`.
- Use `auth bearer @i(token)` when the API needs a bearer token.
- Keep request files small and reuse existing shared `.ntd` files when possible.

## Naming

Use lowercase kebab-case:

- `query-post.ntd` and `query-post.nts`
- `query-user-posts.ntd` and `query-user-posts.nts`
- `mutation-create-post.ntd` and `mutation-create-post.nts`

Name files by operation intent, not by generic endpoint names.

## Schema And Operation Design

Before generating files:

1. Identify the GraphQL endpoint.
2. Use the API docs, schema, or existing examples to confirm field names,
   argument names, input types, and pagination syntax.
3. Keep sample operations small and cheap.
4. Include both a simple entity query and one nested relationship query when the
   API supports it.
5. Include a mutation only when the API supports unauthenticated or documented
   safe test mutations.

Avoid guessing schema names when documentation is available. If schema access is
blocked, say which parts are inferred.

## Validation

After creating or editing GraphQL R1Quest files:

1. Compile every generated `.nts` file.
2. Check each `ref` path exists.
3. Check each body uses `@i(query)` or `@i(mutation)` and `@i(variables)`.
4. Run a small query with one-shot execution when network access is allowed:

```bash
r1q -r ./example -p request/queries/query-post.nts
```

or:

```bash
npx ntee-r1quest -r ./example -p request/queries/query-post.nts
```

Report whether validation was compile-only or live-executed.
