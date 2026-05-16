import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals"
import { join } from "node:path"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { execute, parseArguments, resolveRoot } from "../src/runtime/command.ts"

const server = setupServer()

describe("command runtime", () => {
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

  test("parses the root argument and ignores request file arguments", () => {
    expect(parseArguments(["get", "-r", "./requests"])).toEqual({
      root: "./requests",
    })
  })

  test("resolves -r relative to the current working directory", () => {
    const originalWorkingDirectory = process.cwd()

    expect(resolveRoot(["-r", "test/data"])).toBe(
      join(originalWorkingDirectory, "test/data"),
    )
  })

  test("executes a command input request file relative to root and restores cwd", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token")

        return HttpResponse.json({
          method: "get",
          ok: true,
        })
      }),
    )

    const originalWorkingDirectory = process.cwd()
    const response = await execute(
      "get",
      join(originalWorkingDirectory, "test/data"),
    )

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    })
    expect(process.cwd()).toBe(originalWorkingDirectory)
  })

  test("executes nested command input under the resolved root", async () => {
    server.use(
      http.get("https://ntee.io", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("bearer test-token")

        return HttpResponse.json({
          method: "get",
          ok: true,
        })
      }),
    )

    const originalWorkingDirectory = process.cwd()
    const response = await execute(
      "nested/get",
      join(originalWorkingDirectory, "test/data"),
    )

    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      method: "get",
      ok: true,
    })
    expect(process.cwd()).toBe(originalWorkingDirectory)
  })

  test("uses .r1qconfig.json root from the current directory", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-cwd",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveRoot()).toBe(join(originalWorkingDirectory, "test/data"))
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })
})
