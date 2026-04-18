import { describe, expect, test } from "bun:test";
import { compile } from "./semantics.ts";

describe("compiler semantics", () => {
  test("compiles a valid request document into a scope object", () => {
    const input = `url "http://www.123.com/"

header name, value
header name1, value2
auth basic xxxxxxxx

body {
  value: {
    name: "x"
    age: 2
    female: false
  }
  version: 2.3
  support: [1, 2, 3]
  author: ["a", "b", "c"]
}`;

    expect(compile(input)).toEqual({
      url: "http://www.123.com/",
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

  test("throws when the request document has a compile error", () => {
    const input = `url "http://www.123.com/"

header name value

body {
  value: true
}`;

    expect(() => compile(input)).toThrow(SyntaxError);
  });

  test("throws when auth is missing credentials", () => {
    const input = `url "http://www.123.com/"

auth xxxxxxxx

body {
  value: true
}`;

    expect(() => compile(input)).toThrow(SyntaxError);
  });
});
