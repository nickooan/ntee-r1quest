import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { execute } from "../src/runtime/request.ts";
import { compileFile } from "../src/compiler/semantics.ts";

const server = setupServer();

describe("put request", () => {
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

  test("executes the put ohm request and gets the api response", async () => {
    server.use(
      http.put("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(await request.json()).toEqual({
          name: "r1quest-updated",
        });

        return HttpResponse.json({
          method: "put",
          ok: true,
        });
      }),
    );

    const scopeObject = compileFile("test/data/put.nts");
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "put",
      ok: true,
    });
  });
});
