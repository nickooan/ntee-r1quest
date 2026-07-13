import { randomUUID } from "node:crypto"
import { dirname, relative, resolve } from "node:path"
import type { AxiosResponse } from "axios"
import {
  isJointScope,
  parseEnvOverrides,
  type CompileResult,
  type JointScopeObject,
  type PickSource,
} from "../compiler/semantics.ts"

// Runs one chain step as a regular one-shot request. Supplied by the caller so
// this module stays free of the cwd/env-override plumbing in cli-command.
export type JointStepRunner = (options: {
  source: string
  traceId: string
  env: string
  validateScope: (scope: CompileResult) => void
}) => Promise<AxiosResponse>

export interface JointStepResult {
  stepIndex: number
  stepCount: number
  runTarget: string
  // Step path relative to the collection root, for display and events.
  source: string
  response: AxiosResponse
  startedAt: number
  durationMs: number
  traceId: string
}

export interface JointRunOptions {
  root: string
  // Absolute path of the compiled joint file; @run targets resolve against
  // its directory.
  jointPath: string
  joint: JointScopeObject
  cliTraceId?: string
  cliEnv?: string
  runStep: JointStepRunner
  // Invoked after each intermediate step (never for the final one, whose
  // response is the chain's result).
  onStepComplete?: (step: JointStepResult) => void | Promise<void>
}

export interface JointChainResult {
  response: AxiosResponse
  traceId: string
  stepCount: number
}

export class JointStepError extends Error {
  readonly stepIndex: number
  readonly stepCount: number
  readonly runTarget: string
  readonly traceId: string

  constructor(
    stepIndex: number,
    stepCount: number,
    runTarget: string,
    traceId: string,
    cause: unknown,
  ) {
    super(`Joint step ${stepIndex + 1}/${stepCount} (${runTarget}) failed.`, {
      cause,
    })
    this.name = "JointStepError"
    this.stepIndex = stepIndex
    this.stepCount = stepCount
    this.runTarget = runTarget
    this.traceId = traceId
  }
}

export const isJointStepError = (error: unknown): error is JointStepError =>
  error instanceof JointStepError

/**
 * Reads a value out of a response body by a compiled @pick json path — dot
 * segments plus [n] indexes only, as constrained by the grammar. Throws a
 * ReferenceError naming the first segment that cannot be resolved.
 */
export const evaluateJsonPath = (data: unknown, path: string): unknown => {
  const segments = [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((match) =>
    match[1] !== undefined ? match[1] : Number(match[2]),
  )
  let current: unknown = data

  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      throw new ReferenceError(
        `Cannot resolve json path "${path}": "${segment}" is not reachable in the previous response body.`,
      )
    }

    current = (current as Record<string | number, unknown>)[segment]

    if (current === undefined) {
      throw new ReferenceError(
        `Cannot resolve json path "${path}": "${segment}" is missing from the previous response body.`,
      )
    }
  }

  return current
}

/**
 * Executes a compiled joint chain: steps run strictly in order, each one a
 * regular one-shot request recorded to history under the shared trace id.
 * Picked values accumulate across steps (later keys win) and reach each step
 * as `-env`-style overrides, so a value picked at step 1 is still available
 * at step 3. Any failure stops the chain and surfaces as a JointStepError.
 */
export const runJointChain = async (
  options: JointRunOptions,
): Promise<JointChainResult> => {
  const traceId =
    options.cliTraceId || options.joint.traceId || generateJointTraceId()
  const chainEnv = parseEnvOverrides(options.cliEnv)
  const jointDir = dirname(options.jointPath)
  const stepCount = options.joint.steps.length
  let previousResponse: AxiosResponse | undefined

  for (const [stepIndex, step] of options.joint.steps.entries()) {
    try {
      if (step.pick) {
        mergePick(chainEnv, step.pick, previousResponse)
      }

      const source = normalizeStepSource(resolve(jointDir, step.run))
      const startedAt = Date.now()
      const response = await options.runStep({
        source,
        traceId,
        env: JSON.stringify(chainEnv),
        validateScope: (scope) => assertJointStepScope(scope, step.run),
      })

      assertJsonResponse(response, step.run)
      previousResponse = response

      if (stepIndex < stepCount - 1) {
        await options.onStepComplete?.({
          stepIndex,
          stepCount,
          runTarget: step.run,
          source: relative(options.root, source),
          response,
          startedAt,
          durationMs: Date.now() - startedAt,
          traceId,
        })
      }
    } catch (error) {
      throw new JointStepError(stepIndex, stepCount, step.run, traceId, error)
    }
  }

  if (!previousResponse) {
    throw new Error("A joint chain must contain at least one @run step.")
  }

  return { response: previousResponse, traceId, stepCount }
}

const generateJointTraceId = (): string =>
  `joint-${Date.now()}-${randomUUID().slice(0, 8)}`

const normalizeStepSource = (source: string): string =>
  source.endsWith(".nts") ? source : `${source}.nts`

// Merges one step's picked values into the accumulated chain env. Non-string
// values are JSON-stringified to match the `-env` coercion in
// parseEnvOverrides.
const mergePick = (
  chainEnv: Record<string, string>,
  pick: Record<string, PickSource>,
  previousResponse: AxiosResponse | undefined,
): void => {
  for (const [key, source] of Object.entries(pick)) {
    let value: unknown

    if (source.kind === "value") {
      value = source.value
    } else {
      if (!previousResponse) {
        throw new ReferenceError(
          `Cannot resolve json path "${source.path}" before any response exists.`,
        )
      }

      value = evaluateJsonPath(previousResponse.data, source.path)
    }

    chainEnv[key] = typeof value === "string" ? value : JSON.stringify(value)
  }
}

// The rule of @joint: every chained request must be a plain application/json
// request — nested joints and other content types are rejected before the
// request is sent.
const assertJointStepScope = (
  scope: CompileResult,
  runTarget: string,
): void => {
  if (isJointScope(scope)) {
    throw new Error(
      `A joint file cannot @run another joint file (${runTarget}).`,
    )
  }

  const contentType = String(scope.headers["content-type"] ?? "").toLowerCase()

  if (!contentType.includes("application/json")) {
    throw new Error(
      `@joint chains only allow application/json requests (${runTarget} has ${
        contentType ? `content-type "${contentType}"` : "no content-type"
      }).`,
    )
  }
}

// Responses must be JSON too, so @pick json paths always read structured
// data. A bodyless response with no content-type (e.g. 204 No Content) is
// allowed — picking from it fails naturally at json-path evaluation.
const assertJsonResponse = (
  response: AxiosResponse,
  runTarget: string,
): void => {
  const contentType = String(
    response.headers?.["content-type"] ?? "",
  ).toLowerCase()

  if (contentType.includes("application/json")) {
    return
  }

  const hasBody =
    response.data !== undefined &&
    response.data !== null &&
    response.data !== ""

  if (!contentType && !hasBody) {
    return
  }

  throw new Error(
    `@joint chains only allow application/json responses (${runTarget} returned ${
      contentType
        ? `content-type "${contentType}"`
        : "a body with no content-type"
    }).`,
  )
}
