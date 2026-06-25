#!/usr/bin/env node
import { isAxiosError } from "axios"
import { existsSync } from "node:fs"
import React, { useMemo, useRef, useState } from "react"
import { render } from "ink"
import {
  executePathArgument,
  parseArguments,
  resolveImmediateCommandOutput,
  resolveRuntimeConfig,
} from "./src/runtime/cli-command.ts"
import {
  InProcessRuntimeClient,
  toExecuteResult,
  toRuntimeConfigDto,
} from "./src/runtime/client/index.ts"
import type {
  ExecuteResult,
  RuntimeConfigDto,
} from "./src/runtime/client/types.ts"
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
import { VERSION } from "./src/runtime/version.ts"
import { ConfigGenerator } from "./src/views/config-generator/index.tsx"
import { formatError, formatResponse } from "./src/views/response.ts"
import { TerminalApp } from "./src/views/terminal-app.tsx"

export { VERSION } from "./src/runtime/version.ts"

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

    const socketPath = config.sock
    const requestPath = config.parsedArgs.path

    if (socketPath && requestPath) {
      try {
        await postExternalRequestEvent(
          socketPath,
          buildExternalRequestEvent(
            requestPath,
            Date.now() - requestStartTime,
            responseContent,
            traceId,
          ),
        )
      } catch (error) {
        process.stderr.write(`${formatError(error)}\n`)
      }
    }

    return true
  } catch (error) {
    const traceId = config.parsedArgs.traceId
    // A non-2xx response surfaces as a thrown AxiosError carrying `.response`;
    // render it the same as a success (to stderr, exit 1). Only true failures
    // with no response fall through to the error block.
    const content =
      isAxiosError(error) && error.response
        ? formatResponse(
            toExecuteResult(error.response, Date.now() - requestStartTime),
            traceId,
          )
        : formatError(error, traceId)

    process.stderr.write(`${content}\n`)
    process.exitCode = 1

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

const CommandApp = ({
  args,
  initialConfig,
}: {
  args: string[]
  initialConfig: RuntimeConfig
}) => {
  const client = useMemo(
    () => new InProcessRuntimeClient(args, initialConfig),
    // Constructed once for the app's lifetime; reloads re-resolve config inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [config, setConfig] = useState<RuntimeConfigDto>(() =>
    toRuntimeConfigDto(initialConfig),
  )
  const [reloadId, setReloadId] = useState(0)
  const [response, setResponse] = useState<ExecuteResult | undefined>()
  const [error, setError] = useState<unknown>()
  const [isPending, setIsPending] = useState(false)
  const [requestDurationMs, setRequestDurationMs] = useState<
    number | undefined
  >()
  const commandRunIdRef = useRef(0)

  const runCommand = async (command: string) => {
    const commandRunId = commandRunIdRef.current + 1
    const requestStartTime = Date.now()

    commandRunIdRef.current = commandRunId
    setIsPending(true)
    setResponse(undefined)
    setError(undefined)
    setRequestDurationMs(undefined)

    try {
      const nextResponse = await client.execute({ command })

      if (commandRunIdRef.current === commandRunId) {
        setResponse(nextResponse)
      }
    } catch (nextError) {
      if (commandRunIdRef.current === commandRunId) {
        setError(nextError)
      }
    } finally {
      if (commandRunIdRef.current === commandRunId) {
        setRequestDurationMs(Date.now() - requestStartTime)
        setIsPending(false)
      }
    }
  }

  const reloadRuntime = () => {
    commandRunIdRef.current += 1
    setResponse(undefined)
    setError(undefined)
    setIsPending(false)
    setRequestDurationMs(undefined)

    // reload() drops the cached config and re-scans config files (root, ai,
    // custom-ai-commands, ...) from disk inside the client.
    void client
      .reload()
      .then((nextConfig) => {
        setConfig(nextConfig)
        setReloadId((currentValue) => currentValue + 1)
      })
      .catch((nextError: unknown) => {
        setError(nextError)
      })
  }

  return React.createElement(TerminalApp, {
    key: reloadId,
    client,
    response,
    error,
    isPending,
    root: config.root,
    version: config.version,
    aiAdaptor: config.aiAdaptor,
    customCommands: config.customCommands,
    externalEventSocket: config.externalEventSocket,
    requestDurationMs,
    onCommand: runCommand,
    onReload: reloadRuntime,
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
        render(React.createElement(CommandApp, { args, initialConfig: config }))
      }
    }
  }
}
