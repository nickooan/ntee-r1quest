import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { compile } from "../src/compiler/semantics.ts";
import { execute } from "../src/runtime/request.ts";

const server = setupServer();

describe("json request", () => {
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "error",
    });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  test("executes a json object request using user ntd data", async () => {
    const input = `ref ./user.ntd

url "https://ntee.io"
type post

header content-type, application/json
auth bearer @i(token)

body {
  name: "r1quest"
  spid: @i(name)
  description: my age is @i(age)
  off: @i(off)
  arr: @i(arr)
}`;

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(await request.json()).toEqual({
          name: "r1quest",
          spid: "macro-name",
          description: "my age is 2",
          off: false,
          arr: ["macro", 2, false],
        });

        return HttpResponse.json({
          method: "post",
          ok: true,
        });
      }),
    );

    const scopeObject = compile(input, {
      cwd: "test/data",
    });
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });

  test("executes a json array request using array ntd data", async () => {
    const input = `ref ./array.ntd

url "https://ntee.io"
type post

header content-type, application/json

body @i(array-body)`;

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(await request.json()).toEqual([{ name: "a" }, { name: "b" }]);

        return HttpResponse.json({
          method: "post",
          ok: true,
        });
      }),
    );

    const scopeObject = compile(input, {
      cwd: "test/data",
    });
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });

  test("executes a raw json string request using json string ntd data", async () => {
    const input = `ref ./json-string.ntd

url "https://ntee.io"
type post

header content-type, application/json

body @i(json-string)`;

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(await request.json()).toEqual({
          source: "json-string",
          ok: true,
          count: 2,
        });

        return HttpResponse.json({
          method: "post",
          ok: true,
        });
      }),
    );

    const scopeObject = compile(input, {
      cwd: "test/data",
    });
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });
});
