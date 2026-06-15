import type { AxiosResponse } from "axios"
import { compileFile, CompileSourceType } from "../compiler/semantics.ts"
import { resolveAdaptorName, type AcpAdaptorName } from "./acp/index.ts"
import {
  initializeRuntimeConfig,
  loadRuntimeConfig,
  parseArguments,
  type RuntimeConfig,
} from "./config.ts"
import { execute as executeRequest } from "./request.ts"
import { recordApiCall } from "./cache/index.ts"
import { APP_NAME, VERSION } from "./version.ts"

export { parseArguments } from "./config.ts"

export const resolveImmediateCommandOutput = (
  args: string[] = [],
): string | undefined => {
  const parsedArgs = parseArguments(args)

  if (parsedArgs.version) {
    return `${APP_NAME} ${VERSION}\n`
  }

  return undefined
}

type ExecuteOptions = {
  root: string
  source: string
}

export const resolveRoot = (args: string[] = []): string => {
  return initializeRuntimeConfig(args).root
}

export const resolveAiAdaptor = (
  args: string[] = [],
): AcpAdaptorName | undefined => {
  const inputAiAdaptor = initializeRuntimeConfig(args).ai

  if (!inputAiAdaptor) {
    return undefined
  }

  return resolveAdaptorName(inputAiAdaptor)
}

export const resolveSock = (root?: string): string | undefined => {
  return root
    ? loadRuntimeConfig(["-r", root]).sock
    : initializeRuntimeConfig().sock
}

const normalizeSource = (source: string): string => {
  const trimmedSource = source.trim()

  if (!trimmedSource) {
    throw new Error("Cannot execute request without a source file.")
  }

  return trimmedSource.endsWith(".nts") ? trimmedSource : `${trimmedSource}.nts`
}

const runRequest = async (options: ExecuteOptions): Promise<AxiosResponse> => {
  const previousWorkingDirectory = process.cwd()

  process.chdir(options.root)

  try {
    const scopeObject = compileFile(options.source, CompileSourceType.File)
    const startedAt = Date.now()
    const response = await executeRequest(scopeObject)

    // Record successful calls only; failures throw above and are skipped.
    // Awaited so one-shot CLI runs persist the entry before the process exits.
    await recordApiCall({
      at: startedAt,
      durationMs: Date.now() - startedAt,
      request: {
        url: scopeObject.url,
        method: scopeObject.method,
        headers: scopeObject.headers,
        body: scopeObject.body,
      },
      response: {
        status: response.status,
        headers: response.headers as Record<string, unknown>,
        data: response.data,
      },
    })

    return response
  } finally {
    process.chdir(previousWorkingDirectory)
  }
}

export const execute = async (
  source: string,
  root: string = resolveRoot(),
): Promise<AxiosResponse> => {
  return runRequest({
    root,
    source: normalizeSource(source),
  })
}

export const executePathArgument = async (
  args: string[] = [],
): Promise<AxiosResponse | undefined> => {
  const config = initializeRuntimeConfig(args)
  const parsedArgs = config.parsedArgs

  if (!parsedArgs.path) {
    return undefined
  }

  return execute(parsedArgs.path, config.root)
}

export const resolveRuntimeConfig = (args: string[] = []): RuntimeConfig => {
  return initializeRuntimeConfig(args)
}
