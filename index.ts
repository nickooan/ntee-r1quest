#!/usr/bin/env node
import type { AxiosResponse } from "axios"
import React, { useMemo, useState } from "react"
import { render } from "ink"
import {
  execute,
  executePathArgument,
  resolveAiAdaptor,
  resolveRoot,
} from "./src/runtime/command.ts"
import { VERSION } from "./src/runtime/version.ts"
import { formatError, formatResponse } from "./src/views/response.tsx"
import { TerminalApp } from "./src/views/terminal-app.tsx"

export { VERSION } from "./src/runtime/version.ts"

const runPathArgument = async (args: string[]): Promise<boolean> => {
  try {
    const response = await executePathArgument(args)

    if (!response) {
      return false
    }

    process.stdout.write(formatResponse(response))

    return true
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`)
    process.exitCode = 1

    return true
  }
}

const CommandApp = ({ args }: { args: string[] }) => {
  const root = useMemo(() => resolveRoot(args), [args])
  const aiAdaptor = useMemo(() => resolveAiAdaptor(args), [args])
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
    requestDurationMs,
    onCommand: runCommand,
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const didRunPathArgument = await runPathArgument(args)

  if (!didRunPathArgument) {
    render(React.createElement(CommandApp, { args }))
  }
}
