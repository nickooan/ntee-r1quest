import { describe, expect, test } from "@jest/globals"
import { formatEndpointLabel } from "../src/runtime/cache/endpoint.ts"

describe("formatEndpointLabel", () => {
  test("uses path + method for plain REST requests", () => {
    expect(formatEndpointLabel("https://h/a/b/c", "POST", { name: "x" })).toBe(
      "/a/b/c [post]",
    )
    expect(formatEndpointLabel("https://h/a/b/c", "GET")).toBe("/a/b/c [get]")
  })

  test("uses the GraphQL operation name + type when the body is a query", () => {
    expect(
      formatEndpointLabel("https://h/api", "POST", {
        query: "mutation CreatePost($x: String) { createPost(x: $x) { id } }",
      }),
    ).toBe("CreatePost [mutation]")

    expect(
      formatEndpointLabel("https://h/api", "POST", {
        query: "query GetUser { user { id } }",
      }),
    ).toBe("GetUser [query]")
  })

  test("prefers an explicit operationName and parses JSON string bodies", () => {
    expect(
      formatEndpointLabel("https://h/api", "POST", {
        query: "query Ignored { a }",
        operationName: "RealName",
      }),
    ).toBe("RealName [query]")

    expect(
      formatEndpointLabel(
        "https://h/api",
        "POST",
        '{"query":"subscription OnPost { postAdded { id } }"}',
      ),
    ).toBe("OnPost [subscription]")
  })

  test("falls back to path + method for anonymous/non-GraphQL bodies", () => {
    // Anonymous shorthand query has no operation name.
    expect(
      formatEndpointLabel("https://h/api", "POST", {
        query: "{ user { id } }",
      }),
    ).toBe("/api [post]")
    expect(formatEndpointLabel("https://h/api", "POST", { foo: 1 })).toBe(
      "/api [post]",
    )
  })
})
