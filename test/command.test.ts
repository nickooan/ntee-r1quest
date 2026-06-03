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
import {
  execute,
  executePathArgument,
  parseArguments,
  resolveAiAdaptor,
  resolveRoot,
  resolveRuntimeConfig,
  resolveSock,
} from "../src/runtime/command.ts"

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

  test("parses root and ai arguments and ignores request file arguments", () => {
    expect(
      parseArguments(["get", "-r", "./requests", "-ai", "claude"]),
    ).toEqual({
      ai: "claude",
      root: "./requests",
    })
  })

  test("parses path argument", () => {
    expect(parseArguments(["-p", "users/get.nts"])).toEqual({
      path: "users/get.nts",
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

  test("executes a -p request file with extension under the resolved root", async () => {
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
    const response = await executePathArgument([
      "-r",
      join(originalWorkingDirectory, "test/data"),
      "-p",
      "nested/get.nts",
    ])

    expect(response?.status).toBe(200)
    expect(response?.data).toEqual({
      method: "get",
      ok: true,
    })
    expect(process.cwd()).toBe(originalWorkingDirectory)
  })

  test("does not execute a request when -p is omitted", async () => {
    await expect(executePathArgument(["-r", "test/data"])).resolves.toBe(
      undefined,
    )
  })

  test("uses .r1qconfig.yaml root from the current directory", () => {
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

  test("uses .r1qconfig.yaml ai adaptor from the current directory", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-cwd",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveAiAdaptor()).toBe("claude")
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test("uses -ai before .r1qconfig.yaml ai adaptor", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-cwd",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveAiAdaptor(["-ai", "codex"])).toBe("codex")
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test("loads custom suggestions from .r1qconfig.yaml", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-cwd",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveRuntimeConfig().customSuggestions).toEqual([
        "some-style-id",
        "x-trace-token",
      ])
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test("resolves .r1qconfig.yaml sock from the current directory", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-sock",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveSock()).toBe(join(configWorkingDirectory, "r1q.sock"))
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test("ignores .r1qconfig.json files", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-json-only",
    )

    process.chdir(configWorkingDirectory)

    try {
      expect(resolveRoot()).toBe(configWorkingDirectory)
      expect(resolveAiAdaptor()).toBeUndefined()
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  test("resolves sock from the request root config before current directory config", () => {
    const originalWorkingDirectory = process.cwd()
    const root = join(originalWorkingDirectory, "test/config-root-sock")

    expect(resolveSock(root)).toBe(join(root, "test.sock"))
  })

  test("does not default to an ai adaptor when none is declared", () => {
    expect(resolveAiAdaptor()).toBeUndefined()
  })

  test("raises when ai adaptor is not supported", () => {
    expect(() => {
      resolveAiAdaptor(["-ai", "unsupported"])
    }).toThrow('ACP adaptor "unsupported" is not supported.')
  })
})
