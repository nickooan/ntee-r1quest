import { describe, expect, test } from "bun:test";
import { scriptGrammar } from "./lexer.ts";

describe("lexer grammar", () => {
  test("matches a valid request document", () => {
    const input = `url "http://www.123.com/"

type patch

ref ../../user.ntd

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

    expect(scriptGrammar.match(input).succeeded()).toBe(true);
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
      expect(scriptGrammar.match(`type ${method}`).succeeded()).toBe(true);
    }
  });

  test("matches ref statements with ntd file paths", () => {
    expect(scriptGrammar.match("ref user.ntd").succeeded()).toBe(true);
    expect(scriptGrammar.match("ref ../../user.ntd").succeeded()).toBe(true);
  });

  test("matches reserved words as object keys", () => {
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

    expect(scriptGrammar.match(input).succeeded()).toBe(true);
  });

  test("matches reserved words as header keys", () => {
    for (const key of [
      "header",
      "authorization",
      "auth",
      "url",
      "type",
      "ref",
      "body",
    ]) {
      expect(scriptGrammar.match(`header ${key}, xxx`).succeeded()).toBe(true);
    }
  });

  test("rejects an invalid request document", () => {
    const input = `url "http://www.123.com/"

auth @bad token

body {
  value: true
}`;

    expect(scriptGrammar.match(input).failed()).toBe(true);
  });
});
