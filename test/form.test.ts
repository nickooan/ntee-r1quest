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

describe("form request", () => {
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

  test("executes a form request using user ntd data", async () => {
    const input = `ref ./user.ntd

url "https://ntee.io"
type post

header content-type, multipart/form-data
auth bearer @i(token)

body {
  name: "r1quest"
  spid: @i(spid)
  off: @i(off)
  age: @i(age)
  arr: @i(arr)
  upload: @f(upload.txt)
  uploads: [@f(upload.txt), @f(upload2.txt)]
}`

    server.use(
      http.post("https://ntee.io", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token")
        expect(request.headers.get("content-type")).toStartWith(
          "multipart/form-data",
        )

        const formData = await request.formData()

        expect(formData.get("name")).toBe("r1quest")
        expect(formData.get("spid")).toBe("xxx-xxx-xxxx")
        expect(formData.get("off")).toBe("false")
        expect(formData.get("age")).toBe("2")
        expect(formData.get("arr")).toBe(JSON.stringify(["macro", 2, false]))

        const upload = formData.get("upload") as Blob
        const uploads = formData.getAll("uploads") as Blob[]

        expect(upload).toBeInstanceOf(Blob)
        expect(await upload.text()).toBe("hello file\n")
        expect(uploads).toHaveLength(2)
        expect(await uploads[0]!.text()).toBe("hello file\n")
        expect(await uploads[1]!.text()).toBe("hello file 2\n")

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
