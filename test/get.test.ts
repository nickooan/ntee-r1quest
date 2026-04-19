import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { execute } from "../src/actuator/request-runner.ts";
import { compileFile } from "../src/compiler/semantics.ts";

const server = setupServer();

describe("get request", () => {
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

  test("executes the get ohm request and gets the api response", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const scopeObject = compileFile("test/data/get.nts");
    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
  });
});
