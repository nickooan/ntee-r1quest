import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { execute } from "../src/runtime/command.ts";

const server = setupServer();

describe("command execute", () => {
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

  test("executes a request file relative to root and restores cwd", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const originalWorkingDirectory = process.cwd();
    const response = await execute([
      "get",
      "-r",
      join(originalWorkingDirectory, "test/data"),
    ]);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
    expect(process.cwd()).toBe(originalWorkingDirectory);
  });

  test("uses -r to override the root argument", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const originalWorkingDirectory = process.cwd();
    const response = await execute([
      "get",
      "-r",
      join(originalWorkingDirectory, "test/data"),
    ]);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
    expect(process.cwd()).toBe(originalWorkingDirectory);
  });

  test("uses -d raw nts source instead of a request file", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(request.headers.get("accept")).toBe("application/json");
        expect(request.headers.get("content-type")).toBe("application/json");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const originalWorkingDirectory = process.cwd();
    const response = await execute([
      "-r",
      join(originalWorkingDirectory, "test/data"),
      "-d",
      'url "https://ntee.io"\ntype get\n\nheader accept, application/json\nheader content-type, application/json\nauth bearer test-token\n',
    ]);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
    expect(process.cwd()).toBe(originalWorkingDirectory);
  });

  test("uses current directory when root and execute file are not provided", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(request.headers.get("accept")).toBe("application/json");
        expect(request.headers.get("content-type")).toBe("application/json");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const originalWorkingDirectory = process.cwd();
    const response = await execute([
      "-d",
      'url "https://ntee.io"\ntype get\n\nheader accept, application/json\nheader content-type, application/json\nauth bearer test-token\n',
    ]);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
    expect(process.cwd()).toBe(originalWorkingDirectory);
  });
});
