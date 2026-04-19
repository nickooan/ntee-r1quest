import { describe, expect, test } from "bun:test";
import { compile } from "./semantics.ts";

describe("compiler semantics", () => {
  test("compiles a valid request document into a scope object", () => {
    const input = `url "http://www.123.com/"

type post

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

  test("compiles reserved words as object keys", () => {
    const input = `body {
  nameObj: {
    header: "header"
    authorization: "authorization"
    auth: "auth"
    url: "url"
    type: "type"
    ref: "ref"
    body: {
      name: "x"
    }
  }
}`;

    expect(compile(input)).toEqual({
      headers: {},
      body: {
        nameObj: {
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
      },
    });
  });

  test("compiles reserved words as header keys", () => {
    const input = `header ref, xxx
header body, yyy`;

    expect(compile(input)).toEqual({
      headers: {
        ref: "xxx",
        body: "yyy",
      },
    });
  });
});
