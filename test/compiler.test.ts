import { describe, expect, test } from "bun:test";
import { buildItermediateObject, compileFile } from "../src/compiler/semantics.ts";

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
    });
  });

  test("compiles an object body request", () => {
    expect(compileFile("test/data/compiler-object-body.nts")).toEqual({
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
    });
  });

  test("compiles reserved words as body and header keys", () => {
    expect(compileFile("test/data/compiler-reserved-keys.nts")).toEqual({
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
    });
  });

  test("compiles headers as lowercase with quoted and unquoted values", () => {
    expect(compileFile("test/data/compiler-header-values.nts")).toEqual({
      headers: {
        "content-type": "application/json",
        "trace-token": "abc",
        "x-request-id": "xyz",
      },
    });
  });

  test("compiles multiline quoted strings in body values", () => {
    expect(compileFile("test/data/compiler-multiline-body-value.nts")).toEqual({
      headers: {},
      body: {
        description:
          "my age is 2\nanother line asdf, asdg\nand some how bla balbal\n",
      },
    });
  });

  test("compiles array body values", () => {
    expect(compileFile("test/data/compiler-array-body.nts")).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
    });
  });

  test("compiles macro body values", () => {
    expect(compileFile("test/data/compiler-macro-body.nts")).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
    });
  });

  test("throws when the request document has a compile error", () => {
    expect(() => compileFile("test/data/invalid-header.nts")).toThrow(
      SyntaxError,
    );
  });

  test("throws when auth is missing credentials", () => {
    expect(() => compileFile("test/data/invalid-auth.nts")).toThrow(SyntaxError);
  });

  test("throws when a macro is missing from the intermediate object", () => {
    expect(() => compileFile("test/data/missing-macro.nts")).toThrow(
      ReferenceError,
    );
    expect(() => compileFile("test/data/missing-macro.nts")).toThrow(
      "Undefined macro: $i.missing",
    );
  });
});
