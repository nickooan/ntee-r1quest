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

  test("compiles header keys as lowercase", () => {
    const input = `header Content-Type, application/json
header Trace-Token, abc`;

    expect(compile(input)).toEqual({
      headers: {
        "content-type": "application/json",
        "trace-token": "abc",
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

  test("compiles multiline quoted strings in body values", () => {
    const input = `ref test/data/user.ntd

body {
  description: "my age is $i.age
another line asdf, asdg
and some how bla balbal
"
}`;

    expect(compile(input)).toEqual({
      headers: {},
      body: {
        description:
          "my age is 2\nanother line asdf, asdg\nand some how bla balbal\n",
      },
    });
  });

  test("compiles quoted text body values", () => {
    expect(compile('body "plain text"')).toEqual({
      headers: {},
      body: "plain text",
    });
  });

  test("compiles multiline quoted text body values", () => {
    const input = `body "hello, asdfa
new line
new line
     new line
"`;

    expect(compile(input)).toEqual({
      headers: {},
      body: "hello, asdfa\nnew line\nnew line\n     new line\n",
    });
  });

  test("compiles macro values in quoted text body values", () => {
    const macroOnlyInput = `ref test/data/user.ntd

body "$i.body_from_example"`;
    const mixedInput = `ref test/data/user.ntd

body "my name is $i.name"`;

    expect(compile(macroOnlyInput)).toEqual({
      headers: {},
      body: "hello from macro body",
    });
    expect(compile(mixedInput)).toEqual({
      headers: {},
      body: "my name is macro-name",
    });
  });

  test("compiles array body values", () => {
    expect(compile("body [{ name: a }, { name: b }]")).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
    });
    expect(compile("body [1, 2, 3]")).toEqual({
      headers: {},
      body: [1, 2, 3],
    });
    expect(compile("body [[1, 3], [1, 3]]")).toEqual({
      headers: {},
      body: [
        [1, 3],
        [1, 3],
      ],
    });
    expect(compile("body [{ x: y }, { z: { y: m } }, { o: z }]")).toEqual({
      headers: {},
      body: [{ x: "y" }, { z: { y: "m" } }, { o: "z" }],
    });
  });

  test("compiles macro body values", () => {
    const input = `ref test/data/array.ntd

body $i.array-body`;

    expect(compile(input)).toEqual({
      headers: {},
      body: [{ name: "a" }, { name: "b" }],
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

  test("throws when a macro is missing from the intermediate object", () => {
    const input = `ref test/data/user.ntd

body {
  missing: $i.missing
}`;

    expect(() => compile(input)).toThrow(ReferenceError);
    expect(() => compile(input)).toThrow("Undefined macro: $i.missing");
  });
});
