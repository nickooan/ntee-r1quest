import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { execute } from "../src/runtime/request.ts";
import { compileFile, CompileSourceType } from "../src/compiler/semantics.ts";

const server = setupServer();

describe("delete request", () => {
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

  test("executes the delete ohm request and gets the api response", async () => {
    server.use(
      http.delete("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "delete",
          ok: true,
        });
      }),
    );

    const scopeObject = compileFile("test/data/delete.nts", CompileSourceType.File);
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "delete",
      ok: true,
    });
  });
});
