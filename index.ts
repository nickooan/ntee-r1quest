#!/usr/bin/env node
import type { AxiosResponse } from "axios"
import React, { useMemo, useState } from "react"
import { render } from "ink"
import { execute, resolveRoot } from "./src/runtime/command.ts"
import { TerminalApp } from "./src/views/terminal-app.tsx"

export const VERSION = "0.3.1"

const CommandApp = ({ args }: { args: string[] }) => {
  const root = useMemo(() => resolveRoot(args), [args])
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
    requestDurationMs,
    onCommand: runCommand,
  })
}

if (import.meta.main) {
  render(React.createElement(CommandApp, { args: process.argv.slice(2) }))
}
