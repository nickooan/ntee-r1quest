#!/usr/bin/env node
import type { AxiosResponse } from "axios"
import { existsSync } from "node:fs"
import React, { useMemo, useState } from "react"
import { render } from "ink"
import {
  execute,
  executePathArgument,
  parseArguments,
  resolveImmediateCommandOutput,
  resolveRuntimeConfig,
} from "./src/runtime/command.ts"
import { resolveAdaptorName } from "./src/runtime/acp/index.ts"
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
import { formatError, formatResponse } from "./src/views/response.tsx"
import { TerminalApp } from "./src/views/terminal-app.tsx"

export { VERSION } from "./src/runtime/version.ts"

const runPathArgument = async (
  args: string[],
  config: RuntimeConfig,
): Promise<boolean> => {
  try {
    const requestStartTime = Date.now()
    const response = await executePathArgument(args)

    if (!response) {
      return false
    }

    const responseContent = formatResponse(response)

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
          ),
        )
      } catch (error) {
        process.stderr.write(`${formatError(error)}\n`)
      }
    }

    return true
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`)
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

const CommandApp = ({ config }: { config: RuntimeConfig }) => {
  const root = config.root
  const aiAdaptor = useMemo(
    () => (config.ai ? resolveAdaptorName(config.ai) : undefined),
    [config.ai],
  )
  const externalEventSocket = config.sock
  const [response, setResponse] = useState<AxiosResponse | undefined>()
  const [error, setError] = useState<unknown>()
  const [isPending, setIsPending] = useState(false)
  const [requestDurationMs, setRequestDurationMs] = useState<
    number | undefined
  >()

  const runCommand = async (command: string) => {
    const requestStartTime = Date.now()

    setIsPending(true)
    setResponse(undefined)
    setError(undefined)
    setRequestDurationMs(undefined)

    try {
      const nextResponse = await execute(command, root)

      setResponse(nextResponse)
    } catch (nextError) {
      setError(nextError)
    } finally {
      setRequestDurationMs(Date.now() - requestStartTime)
      setIsPending(false)
    }
  }

  return React.createElement(TerminalApp, {
    response,
    error,
    isPending,
    root,
    version: VERSION,
    aiAdaptor,
    externalEventSocket,
    requestDurationMs,
    onCommand: runCommand,
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const immediateCommandOutput = resolveImmediateCommandOutput(args)

  if (immediateCommandOutput !== undefined) {
    process.stdout.write(immediateCommandOutput)
  } else {
    const didRunInitArgument = await runInitArgument(args)

    if (!didRunInitArgument) {
      const config = resolveRuntimeConfig(args)
      const didRunPathArgument = await runPathArgument(args, config)

      if (!didRunPathArgument) {
        render(React.createElement(CommandApp, { config }))
      }
    }
  }
}
