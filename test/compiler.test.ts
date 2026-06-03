import { describe, expect, test } from "@jest/globals"
import {
  buildItermediateObject,
  compileFile,
  CompileSourceType,
} from "../src/compiler/semantics.ts"

describe("compiler", () => {
  test("builds an intermediate object from a definition ref", () => {
    expect(buildItermediateObject("test/data/user.ntd", {})).toEqual({
      spid: "xxx-xxx-xxxx",
      name: "macro-name",
      token: "test-token",
      body_from_example: "hello from macro body",
      authToken: "xxxxasdfasdf",
      "trace-token": "asdgjklasjdklf",
      off: false,
      off2: "false",
      age: 2,
      arr: ["macro", 2, false],
      arr1: ["name", "weight", "xx", 1, true],
      arr2: ["name", "weight", "xx", "1", "true"],
      content: {
        "sub-content": "xyz",
        "sub-content-2": "zyx",
        "sub-array": ["x", "yz", "zz"],
        "sub-number": 2,
        "sub-boolean": false,
      },
    })
  })

  test("builds an intermediate object from env macros in a definition ref", () => {
    const previousValue = process.env.TEST_ENV_TOKEN
    process.env.TEST_ENV_TOKEN = "env-token-value"

    try {
      expect(buildItermediateObject("test/data/env.ntd", {})).toEqual({
        token: "env-token-value",
      })
    } finally {
      if (previousValue === undefined) {
        delete process.env.TEST_ENV_TOKEN
      } else {
        process.env.TEST_ENV_TOKEN = previousValue
      }
    }
  })

  test("builds definition values that start with primitive-looking text as bare strings", () => {
    expect(buildItermediateObject("test/data/primitive-prefix.ntd", {})).toEqual(
      {
        id: "9f006820-df12-4456-8ce4-1bc96a2a3fcc",
        "another-key": "asdfasdgasdg",
        falseValue: "false-positive",
        nullValue: "nullish",
      },
    )
  })

  test("compiles an object body request", () => {
    expect(
      compileFile("test/data/compiler-object-body.nts", CompileSourceType.File),
    ).toEqual({
      url: "http://www.123.com/",
      method: "post",
      headers: {
        name: "value",
        name1: "value2",
        authorization: "basic xxxxxxxx",
      },
      body: {
        value: {
          name: "x",
          age: 2,
          female: false,
        },
        version: 2.3,
        support: [1, 2, 3],
        author: ["a", "b", "c"],
      },
    })
  })

  test("compiles reserved words as body and header keys", () => {
    expect(
      compileFile(
        "test/data/compiler-reserved-keys.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {
        ref: "xxx",
        body: "yyy",
      },
      body: {
        header: "header",
        authorization: "authorization",
        auth: "auth",
        url: "url",
        type: "type",
        ref: "ref",
        body: {
          name: "x",
        },
      },
    })
  })

  test("compiles headers as lowercase with quoted and unquoted values", () => {
    expect(
      compileFile(
        "test/data/compiler-header-values.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {
        "content-type": "application/json",
        "trace-token": "abc",
        "x-request-id": "xyz",
      },
    })
  })

  test("compiles multiline quoted strings in body values", () => {
    expect(
      compileFile(
        "test/data/compiler-multiline-body-value.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {},
      body: {
        description:
          "my age is 2\nanother line asdf, asdg\nand some how bla balbal\n",
      },
    })
  })

  test("compiles multiline GraphQL strings directly in request body values", () => {
    expect(
      compileFile(
        "test/data/compiler-graphql-body.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {},
      body: {
        query:
          "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}",
        variables: {
          id: 123,
        },
      },
    })
  })

  test("compiles multiline GraphQL strings from definition files", () => {
    expect(
      compileFile(
        "test/data/compiler-graphql-definition-body.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {},
      body: {
        query:
          "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}",
        variables: {
          id: 123,
        },
      },
    })
  })

  test("compiles top-level GraphQL query sugar from definition files", () => {
    expect(
      compileFile(
        "test/data/compiler-graphql-sugar-definition-body.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {},
      body: {
        query:
          "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}",
        variables: {
          id: 123,
        },
      },
    })
  })

  test("compiles top-level GraphQL mutation sugar from definition files", () => {
    expect(
      compileFile(
        "test/data/compiler-graphql-sugar-mutation-body.nts",
        CompileSourceType.File,
      ),
    ).toEqual({
      headers: {},
      body: {
        query:
          "mutation CreatePost($input: CreatePostInput!) {\n  createPost(input: $input) {\n    id\n    title\n  }\n}",
        variables: {
          input: {
            title: "Example",
          },
        },
      },
    })
  })

  test("compiles array body values", () => {
    expect(
      compileFile("test/data/compiler-array-body.nts", CompileSourceType.File),
    ).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
    })
  })

  test("compiles macro body values", () => {
    expect(
      compileFile("test/data/compiler-macro-body.nts", CompileSourceType.File),
    ).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
    })
  })

  test("compiles file macro body values", async () => {
    const scopeObject = compileFile(
      "test/data/compiler-file-body.nts",
      CompileSourceType.File,
    )
    const body = scopeObject.body as Record<string, Blob[]>
    const upload = body.upload
    const uploads = body.uploads

    if (!upload || !uploads) {
      throw new Error("Expected compiled file values.")
    }

    expect(upload).toBeArrayOfSize(1)
    expect(uploads).toBeArrayOfSize(2)
    expect(await upload[0]!.text()).toBe("hello file\n")
    expect(await uploads[0]!.text()).toBe("hello file\n")
    expect(await uploads[1]!.text()).toBe("hello file 2\n")
  })

  test("throws when the request document has a compile error", () => {
    expect(() =>
      compileFile("test/data/invalid-header.nts", CompileSourceType.File),
    ).toThrow(SyntaxError)
  })

  test("throws when auth is missing credentials", () => {
    expect(() =>
      compileFile("test/data/invalid-auth.nts", CompileSourceType.File),
    ).toThrow(SyntaxError)
  })

  test("throws when a macro is missing from the intermediate object", () => {
    expect(() =>
      compileFile("test/data/missing-macro.nts", CompileSourceType.File),
    ).toThrow(ReferenceError)
    expect(() =>
      compileFile("test/data/missing-macro.nts", CompileSourceType.File),
    ).toThrow("Undefined macro: @i(missing)")
  })
})
