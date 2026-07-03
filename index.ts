#!/usr/bin/env node
import { isAxiosError } from "axios"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import React from "react"
import { render } from "ink"
import {
  executePathArgument,
  parseArguments,
  resolveImmediateCommandOutput,
  resolveRuntimeConfig,
} from "./src/runtime/cli-command.ts"
import { toExecuteResult } from "./src/runtime/client/index.ts"
import { runStartupBeforeActions } from "./src/runtime/startup.ts"
import {
  formatInstallClaudePluginResult,
  installClaudePlugin,
} from "./src/runtime/claude-plugin.ts"
import {
  getHomeConfigPath,
  initializeHomeConfig,
  type InitializeHomeConfigResult,
  type RuntimeConfig,
} from "./src/runtime/config.ts"
import {
  buildExternalRequestEvent,
  postExternalRequestEvent,
} from "./src/runtime/external-event/index.ts"
import type { RecordApiCallInput } from "./src/runtime/cache/index.ts"
import { ConfigGenerator } from "./src/views/config-generator/index.tsx"
import { formatError, formatResponse } from "./src/views/response.ts"
import type { AxiosResponse } from "axios"

export { VERSION } from "./src/runtime/version.ts"

// Builds the full API-call record carried on the external event, from the
// request fields axios kept on the response. While a terminal app is open it
// holds the history store's single-writer lock, so this run can't record the
// call itself — the app persists this payload on receipt.
const toCallRecord = (
  response: AxiosResponse,
  startedAt: number,
  traceId?: string,
): RecordApiCallInput => ({
  at: startedAt,
  durationMs: Date.now() - startedAt,
  traceId,
  request: {
    url: response.config?.url,
    method: response.config?.method,
    headers: (response.config?.headers ?? {}) as Record<string, unknown>,
    body: response.config?.data,
  },
  response: {
    status: response.status,
    headers: response.headers as Record<string, unknown>,
    data: response.data,
  },
})

// Posts the event to an open terminal app, if any. A missing or dead socket is
// the normal "no app is running" case and stays quiet; only unexpected errors
// are reported.
const postToOpenApp = async (
  config: RuntimeConfig,
  requestPath: string | undefined,
  requestStartTime: number,
  responseContent: string,
  response: AxiosResponse,
  traceId?: string,
): Promise<void> => {
  const socketPath = config.sock

  if (!socketPath || !requestPath) {
    return
  }

  try {
    await postExternalRequestEvent(
      socketPath,
      buildExternalRequestEvent(
        requestPath,
        Date.now() - requestStartTime,
        responseContent,
        traceId,
        toCallRecord(response, requestStartTime, traceId),
      ),
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code

    if (code !== "ECONNREFUSED" && code !== "ENOENT") {
      process.stderr.write(`${formatError(error)}\n`)
    }
  }
}

const runPathArgument = async (
  args: string[],
  config: RuntimeConfig,
): Promise<boolean> => {
  const requestStartTime = Date.now()

  try {
    const response = await executePathArgument(args)

    if (!response) {
      return false
    }

    const traceId = config.parsedArgs.traceId
    const responseContent = formatResponse(
      toExecuteResult(response, Date.now() - requestStartTime),
      traceId,
    )

    process.stdout.write(responseContent)

    await postToOpenApp(
      config,
      config.parsedArgs.path,
      requestStartTime,
      responseContent,
      response,
      traceId,
    )

    return true
  } catch (error) {
    const traceId = config.parsedArgs.traceId
    // A non-2xx response surfaces as a thrown AxiosError carrying `.response`;
    // render it the same as a success (to stderr, exit 1). Only true failures
    // with no response fall through to the error block.
    const failedResponse =
      isAxiosError(error) && error.response ? error.response : undefined
    const content = failedResponse
      ? formatResponse(
          toExecuteResult(failedResponse, Date.now() - requestStartTime),
          traceId,
        )
      : formatError(error, traceId)

    process.stderr.write(`${content}\n`)
    process.exitCode = 1

    // Failed calls are kept in history too — hand them to an open app the
    // same way (the one-shot's own record is a no-op while an app holds the
    // store lock).
    if (failedResponse && typeof failedResponse.status === "number") {
      await postToOpenApp(
        config,
        config.parsedArgs.path,
        requestStartTime,
        content,
        failedResponse,
        traceId,
      )
    }

    return true
  }
}

const formatInitializeResult = (result: InitializeHomeConfigResult): string => {
  const output: string[] = []

  if (result.createdDirectory) {
    output.push(`Created directory: ${result.createdDirectory}`)
  }

  if (result.createdConfig) {
    output.push(`Created config: ${result.createdConfig}`)
  }

  if (output.length === 0) {
    output.push(`Already initialized: ${result.configPath}`)
  }

  return `${output.join("\n")}\n`
}

const runInstallClaudePluginArgument = (args: string[]): boolean => {
  if (!parseArguments(args).installClaudePlugin) {
    return false
  }

  const result = installClaudePlugin()

  process.stdout.write(formatInstallClaudePluginResult(result))

  if (!result.ok) {
    // Nothing installed (npm install without the plugin source); fail the run so
    // scripts can react, after pointing the user to the Codeberg source.
    process.exitCode = 1
  }

  return true
}

const runInitArgument = async (args: string[]): Promise<boolean> => {
  if (!parseArguments(args).init) {
    return false
  }

  const configPath = getHomeConfigPath()

  if (existsSync(configPath)) {
    process.stdout.write(`Already initialized: ${configPath}\n`)
    return true
  }

  let result: InitializeHomeConfigResult | undefined
  const instance = render(
    React.createElement(ConfigGenerator, {
      configPath,
      onComplete: (config) => {
        result = initializeHomeConfig(undefined, config)
      },
    }),
  )

  await instance.waitUntilExit()

  if (result) {
    process.stdout.write(formatInitializeResult(result))
  }

  return true
}

// Resolves the Go TUI binary: the per-platform build under dist/bin (produced by
// `npm run build:tui` and shipped in the npm package). Only macOS/Linux on
// amd64/arm64 are built; other platforms have no interactive UI.
const resolveGoBinary = (packageRoot: string): string | undefined => {
  const arch = process.arch === "x64" ? "amd64" : process.arch
  const platformBinary = resolve(
    packageRoot,
    "dist",
    "bin",
    `r1q-tui-${process.platform}-${arch}`,
  )
  return existsSync(platformBinary) ? platformBinary : undefined
}

// Launches the Go / Bubble Tea front-end for the interactive session and resolves
// when it exits. The Go binary is the only interactive UI; if it is missing for
// this platform (or fails to spawn) we print an error and exit non-zero. One-shot
// flags (--init, -p, --version, --install-claude-plugin) are handled earlier and
// never reach here.
const launchGoTui = (args: string[], config: RuntimeConfig): Promise<void> => {
  // dist/index.js → dist/ → package root (the repo root in dev).
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const binary = resolveGoBinary(packageRoot)
  const runtimeScript = resolve(packageRoot, "dist", "src", "runtime-server.js")

  if (!binary || !existsSync(runtimeScript)) {
    process.stderr.write(
      `The interactive UI requires the r1q-tui binary for ${process.platform}/${process.arch}, ` +
        "which is not available in this install.\n" +
        "Use one-shot mode (-p <request>) instead, or build from source on a supported platform.\n",
    )
    process.exitCode = 1
    return Promise.resolve()
  }

  const goArgs = [
    "-r",
    config.root,
    "-runtime",
    runtimeScript,
    "-node",
    process.execPath,
  ]
  if (config.ai) {
    goArgs.push("-ai", config.ai)
  }
  if (config.parsedArgs.env) {
    goArgs.push("-env", config.parsedArgs.env)
  }

  return new Promise<void>((resolveLaunch) => {
    let settled = false
    const settle = (code: number) => {
      if (settled) return
      settled = true
      process.exitCode = code
      resolveLaunch()
    }

    const child = spawn(binary, goArgs, { stdio: "inherit" })
    child.on("error", (error) => {
      process.stderr.write(
        `Failed to launch the interactive UI: ${error.message}\n`,
      )
      settle(1)
    })
    child.on("exit", (code) => settle(code ?? 0))
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const immediateCommandOutput = resolveImmediateCommandOutput(args)

  if (immediateCommandOutput !== undefined) {
    process.stdout.write(immediateCommandOutput)
  } else if (!runInstallClaudePluginArgument(args)) {
    const didRunInitArgument = await runInitArgument(args)

    if (!didRunInitArgument) {
      const config = resolveRuntimeConfig(args)
      const didRunPathArgument = await runPathArgument(args, config)

      if (!didRunPathArgument) {
        // Before the interactive TUI boots, prune expired AI sessions so the
        // resume picker never lists dead sessions. Best-effort; never blocks.
        await runStartupBeforeActions(config)

        // The Go / Bubble Tea binary is the interactive UI.
        await launchGoTui(args, config)
      }
    }
  }
}
