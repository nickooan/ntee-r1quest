import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { compileFile, CompileSourceType } from "../src/compiler/semantics.ts";
import { execute } from "../src/runtime/request.ts";

const server = setupServer();

const textFixtures = [
  { file: "text-xml.nts", contentType: "text/xml" },
  { file: "text-calendar.nts", contentType: "text/calendar" },
  { file: "text-css.nts", contentType: "text/css" },
  { file: "text-csv.nts", contentType: "text/csv" },
  { file: "text-javascript.nts", contentType: "text/javascript" },
  { file: "text-markdown.nts", contentType: "text/markdown" },
  { file: "text-rtf.nts", contentType: "text/rtf" },
  { file: "text-vcard.nts", contentType: "text/vcard" },
];

describe("text content type requests", () => {
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

  for (const { file, contentType } of textFixtures) {
    test(`executes ${contentType} request from ${file}`, async () => {
      const scopeObject = compileFile(
        `test/data/${file}`,
        CompileSourceType.File,
      );

      expect(scopeObject.body).toBeString();
      expect(scopeObject.body).not.toBe("");

      server.use(
        http.post("https://ntee.io", async ({ request }) => {
          expect(request.headers.get("accept")).toBe(contentType);
          expect(request.headers.get("content-type")).toBe(contentType);
          expect(await request.text()).toBe(scopeObject.body);

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
  }
});
