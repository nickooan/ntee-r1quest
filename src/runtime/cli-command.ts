import { isAxiosError, type AxiosResponse } from "axios"
import {
  compileFile,
  CompileSourceType,
  parseEnvOverrides,
  setEnvOverrides,
  type ScopeObject,
} from "../compiler/semantics.ts"
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
  traceId?: string
  // JSON object string from the `-env` flag; merged over process.env for macros.
  env?: string
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

// Persists one call to the cache. Awaited so one-shot CLI runs persist the
// entry before the process exits.
const recordCall = async (
  scopeObject: ScopeObject,
  response: AxiosResponse,
  startedAt: number,
  traceId?: string,
): Promise<void> => {
  await recordApiCall({
    at: startedAt,
    durationMs: Date.now() - startedAt,
    traceId,
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
}

const runRequest = async (options: ExecuteOptions): Promise<AxiosResponse> => {
  const previousWorkingDirectory = process.cwd()

  process.chdir(options.root)

  try {
    // Apply `-env` overrides (if any) so @env(...) macros resolve them first,
    // falling back to process.env. Reset each run from this request's flag.
    setEnvOverrides(parseEnvOverrides(options.env))

    const scopeObject = compileFile(options.source, CompileSourceType.File)
    const startedAt = Date.now()

    try {
      const response = await executeRequest(scopeObject)
      await recordCall(scopeObject, response, startedAt, options.traceId)

      return response
    } catch (error) {
      // A request that reached the server but returned a non-2xx status throws,
      // yet still carries a response with a status — record it before
      // re-throwing so failed calls are kept in history. Pure runtime failures
      // (network errors, missing url, unsupported content type, ...) carry no
      // response and are skipped.
      const failedResponse = isAxiosError(error) ? error.response : undefined

      if (failedResponse && typeof failedResponse.status === "number") {
        await recordCall(
          scopeObject,
          failedResponse,
          startedAt,
          options.traceId,
        )
      }

      throw error
    }
  } finally {
    process.chdir(previousWorkingDirectory)
  }
}

export const execute = async (
  source: string,
  root: string = resolveRoot(),
  traceId?: string,
  env?: string,
): Promise<AxiosResponse> => {
  return runRequest({
    root,
    source: normalizeSource(source),
    traceId,
    env,
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

  return execute(
    parsedArgs.path,
    config.root,
    parsedArgs.traceId,
    parsedArgs.env,
  )
}

export const resolveRuntimeConfig = (args: string[] = []): RuntimeConfig => {
  return initializeRuntimeConfig(args)
}
