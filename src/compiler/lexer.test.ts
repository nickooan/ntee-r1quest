import { describe, expect, test } from "bun:test";
import { definitionGrammar, scriptGrammar } from "./lexer.ts";

describe("lexer grammar", () => {
  test("matches a valid request document", () => {
    const input = `ref ../../user.ntd

url "http://www.123.com/"

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

  test("rejects ref statements after other script statements", () => {
    const input = `url "http://www.123.com/"

ref user.ntd`;

    expect(scriptGrammar.match(input).failed()).toBe(true);
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

  test("matches quoted and unquoted strings in header values", () => {
    expect(scriptGrammar.match("header trace-token, asdgjklasjdklf").succeeded()).toBe(
      true,
    );
    expect(scriptGrammar.match('header trace-token, "asdgjklasjdklf"').succeeded()).toBe(
      true,
    );
  });

  test("matches quoted and unquoted strings in body values", () => {
    const input = `body {
  trace-token: asdgjklasjdklf
  quoted-token: "asdgjklasjdklf"
  arr2: [name, weight, xx, "1", "true"]
  content: {
    sub-content-2: zyx
  }
}`;

    expect(scriptGrammar.match(input).succeeded()).toBe(true);
  });

  test("matches macro values in headers auth and body", () => {
    const input = `header content-type, $i.content-type
header contentType, $i.contentType
auth bearer $i.token

body {
  name: "r1quest"
  spid: $i.name
  description: my age is $i.age
  off: $i.off //boolean

  arr: $i.arr
}`;

    expect(scriptGrammar.match(input).succeeded()).toBe(true);
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

describe("definition lexer grammar", () => {
  test("matches definition documents with quoted and unquoted strings", () => {
    const input = `spid: xxx-xxx-xxxx
authToken: xxxxasdfasdf
trace-token: asdgjklasjdklf //no double quote, default is string
off: false //boolean
off2: "false" // with double quote explicit string
age: 2 //number

arr1: ["name", "weight", "xx", 1, true] //array
arr2: [name, weight, xx, "1", "true"] // all these contents inside will be string
content: {
  sub-content: "xyz"
  sub-content-2: zyx //string
  sub-array: ["x", "yz", "zz"]
  sub-number: 2
  sub-boolean: false
}`;

    expect(definitionGrammar.match(input).succeeded()).toBe(true);
  });
});
