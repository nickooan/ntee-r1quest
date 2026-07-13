import { isAxiosError, type AxiosResponse } from "axios"
import { resolve } from "node:path"
import {
  compileFile,
  CompileSourceType,
  isJointScope,
  parseEnvOverrides,
  setEnvOverrides,
  type CompileResult,
  type ScopeObject,
} from "../compiler/semantics.ts"
import { resolveAdaptorName, type AcpAdaptorName } from "./acp/index.ts"
import {
  initializeRuntimeConfig,
  loadRuntimeConfig,
  parseArguments,
  type RuntimeConfig,
} from "./config.ts"
import { runJointChain, type JointStepResult } from "./joint.ts"
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
  // Invoked on the compiled result before executing, so a joint chain can
  // reject steps (nested joints, non-json requests) before they hit the wire.
  validateScope?: (scope: CompileResult) => void
}

export type PathExecutionResult =
  | { kind: "request"; response: AxiosResponse }
  | {
      kind: "joint"
      response: AxiosResponse
      traceId: string
      stepCount: number
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

const runCompiledRequest = async (
  scopeObject: ScopeObject,
  traceId?: string,
): Promise<AxiosResponse> => {
  const startedAt = Date.now()

  try {
    const response = await executeRequest(scopeObject)
    await recordCall(scopeObject, response, startedAt, traceId)

    return response
  } catch (error) {
    // A request that reached the server but returned a non-2xx status throws,
    // yet still carries a response with a status — record it before
    // re-throwing so failed calls are kept in history. Pure runtime failures
    // (network errors, missing url, unsupported content type, ...) carry no
    // response and are skipped.
    const failedResponse = isAxiosError(error) ? error.response : undefined

    if (failedResponse && typeof failedResponse.status === "number") {
      await recordCall(scopeObject, failedResponse, startedAt, traceId)
    }

    throw error
  }
}

const runRequest = async (options: ExecuteOptions): Promise<AxiosResponse> => {
  const previousWorkingDirectory = process.cwd()

  process.chdir(options.root)

  try {
    // Apply `-env` overrides (if any) so @env(...) macros resolve them first,
    // falling back to process.env. Reset each run from this request's flag.
    setEnvOverrides(parseEnvOverrides(options.env))

    const compileResult = compileFile(options.source, CompileSourceType.File)

    options.validateScope?.(compileResult)

    if (isJointScope(compileResult)) {
      throw new Error(
        `${options.source} is a joint file — run it with -p to execute the chain.`,
      )
    }

    return await runCompiledRequest(compileResult, options.traceId)
  } finally {
    process.chdir(previousWorkingDirectory)
  }
}

// Runs the `-p` source: a regular request executes directly, while a joint
// file executes as an ordered chain of one-shot requests sharing one trace id.
// The chain runs strictly sequentially — runRequest resets the global cwd and
// env overrides per step, so steps must never run concurrently.
const runSource = async (
  options: ExecuteOptions & {
    onStepComplete?: (step: JointStepResult) => void | Promise<void>
  },
): Promise<PathExecutionResult> => {
  const previousWorkingDirectory = process.cwd()

  process.chdir(options.root)

  try {
    setEnvOverrides(parseEnvOverrides(options.env))

    const compileResult = compileFile(options.source, CompileSourceType.File)

    if (isJointScope(compileResult)) {
      const chainResult = await runJointChain({
        root: options.root,
        jointPath: resolve(options.root, options.source),
        joint: compileResult,
        cliTraceId: options.traceId,
        cliEnv: options.env,
        onStepComplete: options.onStepComplete,
        runStep: (step) =>
          runRequest({
            root: options.root,
            source: step.source,
            traceId: step.traceId,
            env: step.env,
            validateScope: step.validateScope,
          }),
      })

      return { kind: "joint", ...chainResult }
    }

    return {
      kind: "request",
      response: await runCompiledRequest(compileResult, options.traceId),
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

// The joint-aware entry point: a regular request resolves to its response,
// while a joint file runs as a chain and resolves to the final response plus
// the shared trace id. Used by the `-p` one-shot and the in-process (TUI)
// execute path.
export const executeSource = async (
  source: string,
  root: string = resolveRoot(),
  traceId?: string,
  env?: string,
  onStepComplete?: (step: JointStepResult) => void | Promise<void>,
): Promise<PathExecutionResult> => {
  return runSource({
    root,
    source: normalizeSource(source),
    traceId,
    env,
    onStepComplete,
  })
}

export const executePathArgument = async (
  args: string[] = [],
  onStepComplete?: (step: JointStepResult) => void | Promise<void>,
): Promise<PathExecutionResult | undefined> => {
  const config = initializeRuntimeConfig(args)
  const parsedArgs = config.parsedArgs

  if (!parsedArgs.path) {
    return undefined
  }

  return executeSource(
    parsedArgs.path,
    config.root,
    parsedArgs.traceId,
    parsedArgs.env,
    onStepComplete,
  )
}

export const resolveRuntimeConfig = (args: string[] = []): RuntimeConfig => {
  return initializeRuntimeConfig(args)
}
