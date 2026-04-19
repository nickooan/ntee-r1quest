import { describe, expect, test } from "bun:test";
import { buildItermediateObject, compile } from "./semantics.ts";

describe("compiler semantics", () => {
  test("compiles a valid request document into a scope object", () => {
    const input = `ref test/data/user.ntd

url "http://www.123.com/"

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

  test("builds an intermediate object from a definition ref", () => {
    expect(buildItermediateObject("test/data/user.ntd", {})).toEqual({
      spid: "xxx-xxx-xxxx",
      name: "macro-name",
      token: "test-token",
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

  test("compiles quoted and unquoted strings in header values", () => {
    const input = `header unquoted, asdgjklasjdklf
header quoted, "asdgjklasjdklf"`;

    expect(compile(input)).toEqual({
      headers: {
        unquoted: "asdgjklasjdklf",
        quoted: "asdgjklasjdklf",
      },
    });
  });

  test("compiles quoted and unquoted strings in body values", () => {
    const input = `body {
  trace-token: asdgjklasjdklf
  quoted-token: "asdgjklasjdklf"
  arr2: [name, weight, xx, "1", "true"]
  content: {
    sub-content-2: zyx
  }
}`;

    expect(compile(input)).toEqual({
      headers: {},
      body: {
        "trace-token": "asdgjklasjdklf",
        "quoted-token": "asdgjklasjdklf",
        arr2: ["name", "weight", "xx", "1", "true"],
        content: {
          "sub-content-2": "zyx",
        },
      },
    });
  });

  test("compiles macro values from the intermediate object", () => {
    const input = `ref test/data/user.ntd

header spid, $i.spid
header token, $i.token
auth bearer $i.token

body {
  name: "r1quest"
  spid: $i.name
  description: my age is $i.age
  off: $i.off //boolean

  arr: $i.arr
}`;

    expect(compile(input)).toEqual({
      headers: {
        spid: "xxx-xxx-xxxx",
        token: "test-token",
        authorization: "bearer test-token",
      },
      body: {
        name: "r1quest",
        spid: "macro-name",
        description: "my age is 2",
        off: false,
        arr: ["macro", 2, false],
      },
    });
  });
});
