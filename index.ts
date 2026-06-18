#!/usr/bin/env node
import type { AxiosResponse } from "axios"
import { existsSync } from "node:fs"
import React, { useMemo, useRef, useState } from "react"
import { render } from "ink"
import {
  execute,
  executePathArgument,
  parseArguments,
  resolveImmediateCommandOutput,
  resolveRuntimeConfig,
} from "./src/runtime/cli-command.ts"
import { resolveAdaptorName } from "./src/runtime/acp/index.ts"
import {
  clearRuntimeConfigCache,
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

    const traceId = config.parsedArgs.traceId
    const responseContent = formatResponse(response, traceId)

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
    process.stderr.write(`${formatError(error, config.parsedArgs.traceId)}\n`)
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

const CommandApp = ({
  args,
  initialConfig,
}: {
  args: string[]
  initialConfig: RuntimeConfig
}) => {
  const [config, setConfig] = useState(initialConfig)
  const [reloadId, setReloadId] = useState(0)
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
      const nextResponse = await execute(command, root)

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

    try {
      // Drop the cached config so a reload re-scans config files (root, ai,
      // custom-ai-commands, ...) from disk instead of returning the boot snapshot.
      clearRuntimeConfigCache()
      setConfig(resolveRuntimeConfig(args))
      setReloadId((currentValue) => currentValue + 1)
    } catch (nextError) {
      setError(nextError)
    }
  }

  return React.createElement(TerminalApp, {
    key: reloadId,
    response,
    error,
    isPending,
    root,
    version: VERSION,
    aiAdaptor,
    customCommands: config.customCommands,
    externalEventSocket,
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
  } else {
    const didRunInitArgument = await runInitArgument(args)

    if (!didRunInitArgument) {
      const config = resolveRuntimeConfig(args)
      const didRunPathArgument = await runPathArgument(args, config)

      if (!didRunPathArgument) {
        render(React.createElement(CommandApp, { args, initialConfig: config }))
      }
    }
  }
}
