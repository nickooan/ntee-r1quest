import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { compile } from "../src/compiler/semantics.ts"
import { execute } from "../src/runtime/request.ts"

const server = setupServer()

describe("plain text request", () => {
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "error",
    })
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  test("executes a single line plain text request", async () => {
    const input = `ref ./plain-text.ntd

url "https://ntee.io"
type post

header content-type, text/plain

body "@i(single-line)"`

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("content-type")).toBe("text/plain")
        expect(await request.text()).toBe("plain text body")

        return HttpResponse.json({
          method: "post",
          ok: true,
        })
      }),
    )

    const scopeObject = compile(input, {
      cwd: "test/data",
    })
    const response = await execute(scopeObject)

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    })
  })

  test("executes a multiline plain text request", async () => {
    const input = `ref ./plain-text.ntd

url "https://ntee.io"
type post

header content-type, text/plain

body "@i(multi-line)"`

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("content-type")).toBe("text/plain")
        expect(await request.text()).toBe(
          "hello, asdfa\nnew line\nnew line\n     new line\n",
        )

        return HttpResponse.json({
          method: "post",
          ok: true,
        })
      }),
    )

    const scopeObject = compile(input, {
      cwd: "test/data",
    })
    const response = await execute(scopeObject)

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      method: "post",
      ok: true,
    })
  })
})
