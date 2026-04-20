import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ScopeObject } from "../compiler/semantics.ts";
import { execute, handleFormRequest, handleJSONRequest } from "./request-exec.ts";

const server = setupServer();

describe("request exec", () => {
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

  test("executes a get request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "get",
      headers: {
        authorization: "bearer test-token",
        "content-type": "application/json",
      },
    };

    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "get",
          ok: true,
        });
      }),
    );

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    });
  });

  test("executes a post request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "post",
      headers: {
        authorization: "bearer test-token",
        "content-type": "application/json",
      },
      body: {
        name: "r1quest",
      },
    };

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(await request.json()).toEqual({
          name: "r1quest",
        });

        return HttpResponse.json({
          method: "post",
          ok: true,
        });
      }),
    );

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });

  test("executes a multipart form request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "post",
      headers: {
        authorization: "bearer test-token",
        "content-type": "multipart/form-data",
      },
      body: {
        name: "r1quest",
        age: 2,
        enabled: true,
        tags: ["api", "form"],
      },
    };

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(request.headers.get("content-type")).toStartWith(
          "multipart/form-data",
        );

        const formData = await request.formData();

        expect(formData.get("name")).toBe("r1quest");
        expect(formData.get("age")).toBe("2");
        expect(formData.get("enabled")).toBe("true");
        expect(formData.get("tags")).toBe(JSON.stringify(["api", "form"]));

        return HttpResponse.json({
          method: "post",
          ok: true,
        });
      }),
    );

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    });
  });

  test("executes a patch request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "patch",
      headers: {
        authorization: "bearer test-token",
        "content-type": "application/json",
      },
      body: {
        name: "r1quest-patched",
      },
    };

    server.use(
      http.patch("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");
        expect(await request.json()).toEqual({
          name: "r1quest-patched",
        });

        return HttpResponse.json({
          method: "patch",
          ok: true,
        });
      }),
    );

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "patch",
      ok: true,
    });
  });

  test("executes a put request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "put",
      headers: {
        authorization: "bearer test-token",
        "content-type": "application/json",
      },
      body: {
        name: "r1quest-updated",
      },
    };

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

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "put",
      ok: true,
    });
  });

  test("executes a delete request", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "delete",
      headers: {
        authorization: "bearer test-token",
        "content-type": "application/json",
      },
    };

    server.use(
      http.delete("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token");

        return HttpResponse.json({
          method: "delete",
          ok: true,
        });
      }),
    );

    const response = await execute(scopeObject);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      method: "delete",
      ok: true,
    });
  });

  test("throws when content type is missing", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "post",
      headers: {},
      body: {
        name: "r1quest",
      },
    };

    await expect(execute(scopeObject)).rejects.toThrow(
      "Unsupported content type: missing.",
    );
  });

  test("throws when content type is unsupported", async () => {
    const scopeObject: ScopeObject = {
      url: "https://ntee.io",
      method: "post",
      headers: {
        "content-type": "text/plain",
      },
      body: {
        name: "r1quest",
      },
    };

    await expect(execute(scopeObject)).rejects.toThrow(
      "Unsupported content type: text/plain.",
    );
  });

  test("exposes json and form handlers directly", () => {
    expect(handleJSONRequest).toBeFunction();
    expect(handleFormRequest).toBeFunction();
  });
});
