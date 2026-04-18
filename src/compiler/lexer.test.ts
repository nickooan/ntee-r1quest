import { describe, expect, test } from "bun:test";
import { grammar } from "./lexer.ts";

describe("lexer grammar", () => {
  test("matches a valid request document", () => {
    const input = `url "http://www.123.com/"

type patch

header name, value
header name1, value2
authorization basic xxxxxxxx
auth bearer yyyyyyyy

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

    expect(grammar.match(input).succeeded()).toBe(true);
  });

  test("matches all standard HTTP request methods", () => {
    for (const method of [
      "get",
      "head",
      "post",
      "put",
      "delete",
      "connect",
      "options",
      "trace",
      "patch",
    ]) {
      expect(grammar.match(`type ${method}`).succeeded()).toBe(true);
    }
  });

  test("rejects an invalid request document", () => {
    const input = `url "http://www.123.com/"

auth @bad token

body {
  value: true
}`;

    expect(grammar.match(input).failed()).toBe(true);
  });
});
