import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { execute } from "../src/runtime/request-exec.ts";
import { compileFile } from "../src/compiler/semantics.ts";

const server = setupServer();

describe("post request", () => {
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

  test("executes the post ohm request and gets the api response", async () => {
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

    const scopeObject = compileFile("test/data/post.nts");
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });
});
