import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { APP_NAME, VERSION } from "../src/runtime/version.ts"

// Isolate the global-config lookup from the developer's real
// ~/.ntee-r1quest/r1qconfig.yaml: mock os.homedir() to an empty temp dir so
// these tests see no ambient home config. (Setting process.env.HOME doesn't
// work inside the jest VM, and spying on the read-only ESM namespace throws,
// so we mock the module and import the subjects under test dynamically.)
const isolatedHome = mkdtempSync(join(tmpdir(), "r1quest-home-isolate-"))

jest.unstable_mockModule("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os")

  return {
    ...actual,
    default: { ...actual, homedir: () => isolatedHome },
    homedir: () => isolatedHome,
  }
})

const {
  execute,
  executePathArgument,
  parseArguments,
  resolveAiAdaptor,
  resolveImmediateCommandOutput,
  resolveRoot,
  resolveRuntimeConfig,
  resolveSock,
} = await import("../src/runtime/cli-command.ts")
const { initializeHomeConfig } = await import("../src/runtime/config.ts")
const { getApiCall, formatEndpointLabel } =
  await import("../src/runtime/cache/index.ts")

const server = setupServer()

describe("CLI command runtime", () => {
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
    rmSync(isolatedHome, { recursive: true, force: true })
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

  test("parses the -ti trace id argument", () => {
    expect(parseArguments(["-p", "users/get.nts", "-ti", "batch-42"])).toEqual({
      path: "users/get.nts",
      traceId: "batch-42",
    })
  })

  test("parses the -env JSON override argument", () => {
    expect(
      parseArguments(["-p", "users/get.nts", "-env", '{"TOKEN":"abc"}']),
    ).toEqual({
      path: "users/get.nts",
      env: '{"TOKEN":"abc"}',
    })
  })

  test("parses init and version flags", () => {
    expect(parseArguments(["--init", "--version"])).toEqual({
      init: true,
      version: true,
    })
  })

  test("initializes missing home config files from selected values", () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "r1quest-home-"))

    try {
      const configDirectory = join(homeDirectory, ".ntee-r1quest")
      const configPath = join(configDirectory, "r1qconfig.yaml")
      const result = initializeHomeConfig(homeDirectory, {
        root: "~/collections/example",
        ai: "claude",
      })

      expect(result).toEqual({
        configPath,
        createdDirectory: configDirectory,
        createdConfig: configPath,
      })
      expect(readFileSync(configPath, "utf8")).toBe(
        "root: ~/collections/example\nai: claude\n",
      )
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true })
    }
  })

  test("does not overwrite an existing home config", () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "r1quest-home-"))

    try {
      initializeHomeConfig(homeDirectory, { root: null })
      initializeHomeConfig(homeDirectory, { root: "/replacement", ai: "codex" })

      expect(
        readFileSync(
          join(homeDirectory, ".ntee-r1quest/r1qconfig.yaml"),
          "utf8",
        ),
      ).toBe("root: null\n")
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true })
    }
  })

  test("prints the current app version", () => {
    expect(resolveImmediateCommandOutput(["--version"])).toBe(
      `${APP_NAME} ${VERSION}\n`,
    )
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

  test("records failed responses with a status but skips runtime errors", async () => {
    const root = join(process.cwd(), "test/data")
    const endpoint = formatEndpointLabel("https://ntee.io", "get")

    // A 2xx response is recorded as before.
    server.use(
      http.get("https://ntee.io", () =>
        HttpResponse.json({ ok: true }, { status: 200 }),
      ),
    )
    await execute("get", root)
    expect((await getApiCall(endpoint))?.response.status).toBe(200)

    // A non-2xx response throws (axios default) but still carries a response,
    // so it is recorded.
    server.use(
      http.get("https://ntee.io", () =>
        HttpResponse.json({ message: "Not found" }, { status: 404 }),
      ),
    )
    await expect(execute("get", root)).rejects.toThrow()

    const failed = await getApiCall(endpoint)
    expect(failed?.response.status).toBe(404)
    expect(failed?.response.data).toEqual({ message: "Not found" })

    // A runtime error (network failure, no response) throws and is NOT
    // recorded: the previous 404 record is left untouched.
    server.use(http.get("https://ntee.io", () => HttpResponse.error()))
    await expect(execute("get", root)).rejects.toThrow()
    expect((await getApiCall(endpoint))?.response.status).toBe(404)
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

  test("resolves the Cursor AI adaptor", () => {
    expect(resolveAiAdaptor(["-ai", "cursor"])).toBe("cursor")
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

  test("loads custom commands from .r1qconfig.yaml and skips invalid entries", () => {
    const originalWorkingDirectory = process.cwd()
    const configWorkingDirectory = join(
      originalWorkingDirectory,
      "test/config-cwd",
    )

    process.chdir(configWorkingDirectory)

    try {
      // "incomplete" has no instruction and is dropped.
      expect(resolveRuntimeConfig().customCommands).toEqual([
        {
          name: "for-test",
          description: "use for testing",
          instruction: "asdgasdfasd $1 asdgasdfasgd $2 asdgasdfg $3",
        },
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
