import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Node } from "ohm-js"
import { definitionGrammar, scriptGrammar } from "./lexer.ts"

export type ScopeValue =
  | string
  | number
  | boolean
  | null
  | Blob
  | ScopeValue[]
  | { [key: string]: ScopeValue }

export interface ScopeObject {
  refs?: string[]
  url?: string
  method?: string
  headers: Record<string, string | number | boolean | null>
  body?: ScopeValue
}

// A @pick source: an @i(...) macro is resolved against the joint file's own
// intermediate object at compile time, while a json path into the previous
// step's response body can only be evaluated at run time.
export type PickSource =
  | { kind: "jsonPath"; path: string }
  | { kind: "value"; value: ScopeValue }

export interface JointStepNode {
  pick?: Record<string, PickSource>
  run: string
}

export interface JointScopeObject {
  kind: "joint"
  traceId?: string
  steps: JointStepNode[]
}

export type CompileResult = ScopeObject | JointScopeObject

export const isJointScope = (
  result: CompileResult,
): result is JointScopeObject => (result as JointScopeObject).kind === "joint"

export interface IntermediateObject {
  [key: string]: ScopeValue
}

export interface CompileOptions {
  cwd?: string
}

type HeaderValue = string | number | boolean | null

export const semantics = scriptGrammar
  .createSemantics()
  .addOperation("compile(cwd)", {
    Program(program) {
      return program.compile(this.args.cwd)
    },

    JointProgram(refs, joint, steps) {
      const intermediateObject: IntermediateObject = {}

      for (const ref of refs.children) {
        ref.buildItermediateObject(intermediateObject, this.args.cwd)
      }

      const stepNodes: JointStepNode[] = steps.children.map((step) =>
        step.toJointStep(intermediateObject, this.args.cwd),
      )

      // The leading pick runs before any request, so no response body exists
      // for a json path to read — only @i(...) context sources make sense.
      const firstPick = stepNodes[0]?.pick

      if (
        firstPick &&
        Object.values(firstPick).some((source) => source.kind === "jsonPath")
      ) {
        throw new SyntaxError(
          "The first @pick runs before any response exists — only @i(...) sources are allowed.",
        )
      }

      const jointScope: JointScopeObject = {
        kind: "joint",
        steps: stepNodes,
      }
      const traceId = joint.toTraceId()

      if (traceId !== undefined) {
        jointScope.traceId = traceId
      }

      return jointScope
    },

    RequestProgram(refs, requestStatements, headerStatements, body) {
      const headersObject: ScopeObject["headers"] = {}
      const intermediateObject: IntermediateObject = {}
      const scopeObject: ScopeObject = {
        headers: headersObject,
      }

      for (const ref of refs.children) {
        ref.buildItermediateObject(intermediateObject, this.args.cwd)
      }

      for (const statement of requestStatements.children) {
        statement.compileStatement(
          scopeObject,
          headersObject,
          intermediateObject,
          this.args.cwd,
        )
      }

      for (const statement of headerStatements.children) {
        statement.compileStatement(
          scopeObject,
          headersObject,
          intermediateObject,
          this.args.cwd,
        )
      }

      const bodyNode = body.children[0]

      if (bodyNode) {
        bodyNode.compileStatement(
          scopeObject,
          headersObject,
          intermediateObject,
          this.args.cwd,
        )
      }

      scopeObject.headers = headersObject
      return scopeObject
    },
  })
  .addOperation(
    "compileStatement(scopeObject, headersObject, intermediateObject, cwd)",
    {
      RequestStatement(statement) {
        statement.compileStatement(
          this.args.scopeObject,
          this.args.headersObject,
          this.args.intermediateObject,
          this.args.cwd,
        )
      },

      HeaderStatement(statement) {
        statement.compileStatement(
          this.args.scopeObject,
          this.args.headersObject,
          this.args.intermediateObject,
          this.args.cwd,
        )
      },

      Url(_url, value) {
        this.args.scopeObject.url = value.toValue(
          this.args.intermediateObject,
          this.args.cwd,
        )
      },

      Type(_type, method) {
        this.args.scopeObject.method = method.sourceString
      },

      Authorization(_keyword, scheme, credentials) {
        this.args.headersObject.authorization = `${scheme.sourceString} ${interpolateMacros(
          credentials.sourceString.trim(),
          this.args.intermediateObject,
        )}`
      },

      Header(_header, key, _comma, value) {
        this.args.headersObject[key.sourceString.toLowerCase()] =
          value.toHeaderValue(this.args.intermediateObject, this.args.cwd)
      },

      Body(_body, value) {
        this.args.scopeObject.body = value.toValue(
          this.args.intermediateObject,
          this.args.cwd,
        )
      },
    },
  )
  .addOperation("buildItermediateObject(intermediateObject, cwd)", {
    Ref(_ref, path) {
      buildItermediateObject(
        path.sourceString,
        this.args.intermediateObject,
        this.args.cwd,
      )
    },
  })
  .addOperation<ScopeValue>("toValue(intermediateObject, cwd)", {
    Object(_open, pairs, _close) {
      const object: { [key: string]: ScopeValue } = {}

      for (const pair of pairs.children) {
        const [key, value] = pair.toPair(
          this.args.intermediateObject,
          this.args.cwd,
        )
        object[key] = value
      }

      return object
    },

    Pair(key, _colon, value) {
      const compiledValue = value.toValue(
        this.args.intermediateObject,
        this.args.cwd,
      )

      if (value.getMacroActionName() === "f") {
        return [key.toKey(), [compiledValue]] as [string, ScopeValue]
      }

      return [key.toKey(), compiledValue] as [string, ScopeValue]
    },

    BodyValue(value) {
      return value.toValue(this.args.intermediateObject, this.args.cwd)
    },

    Key(value) {
      return value.toKey()
    },

    Value(value) {
      return value.toValue(this.args.intermediateObject, this.args.cwd)
    },

    Array(_open, values, _close) {
      return values
        .asIteration()
        .children.map((value) =>
          value.toValue(this.args.intermediateObject, this.args.cwd),
        )
    },

    macro(value) {
      return value.toValue(this.args.intermediateObject, this.args.cwd)
    },

    intermediateMacro(_operator, actionName, _open, key, defaultNode, _close) {
      return resolveMacro(
        actionName.sourceString,
        key.sourceString,
        this.args.intermediateObject,
        readMacroDefault(defaultNode),
      )
    },

    fileMacro(_operator, _actionName, _open, path, _close) {
      return resolveFileMacro(path.sourceString, this.args.cwd)
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return interpolateMacros(
        parseQuotedString(this.sourceString),
        this.args.intermediateObject,
      )
    },

    bareString(_) {
      return interpolateMacros(
        this.sourceString.trim(),
        this.args.intermediateObject,
      )
    },

    number(_sign, _digits, _dot, _fraction, _terminator) {
      return Number(this.sourceString)
    },

    boolean(_value, _terminator) {
      return this.sourceString === "true"
    },

    null(_value, _terminator) {
      return null
    },
  })
  .addOperation<[string, ScopeValue]>("toPair(intermediateObject, cwd)", {
    Pair(key, _colon, value) {
      const compiledValue = value.toValue(
        this.args.intermediateObject,
        this.args.cwd,
      )

      if (value.getMacroActionName() === "f") {
        return [key.toKey(), [compiledValue]]
      }

      return [key.toKey(), compiledValue]
    },
  })
  .addOperation<string | undefined>("getMacroActionName()", {
    Value(value) {
      return value.getMacroActionName()
    },

    macro(value) {
      return value.getMacroActionName()
    },

    intermediateMacro(_operator, actionName, _open, _key, _default, _close) {
      return actionName.sourceString
    },

    fileMacro(_operator, actionName, _open, _path, _close) {
      return actionName.sourceString
    },

    Object(_open, _pairs, _close) {
      return undefined
    },

    Array(_open, _values, _close) {
      return undefined
    },

    string(_open, _chars, _close) {
      return undefined
    },

    bareString(_) {
      return undefined
    },

    number(_sign, _digits, _dot, _fraction, _terminator) {
      return undefined
    },

    boolean(_value, _terminator) {
      return undefined
    },

    null(_value, _terminator) {
      return undefined
    },
  })
  .addOperation<string>("toKey()", {
    Key(value) {
      return value.toKey()
    },

    objectKey(_first, _rest) {
      return this.sourceString
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return parseQuotedString(this.sourceString)
    },
  })
  .addOperation<HeaderValue>("toHeaderValue(intermediateObject, cwd)", {
    headerValue(value) {
      return value.toHeaderValue(this.args.intermediateObject, this.args.cwd)
    },

    bareHeaderValue(_) {
      return interpolateMacros(
        this.sourceString.trim(),
        this.args.intermediateObject,
      )
    },

    macro(value) {
      return toHeaderValue(
        value.toValue(this.args.intermediateObject, this.args.cwd),
      )
    },

    intermediateMacro(_operator, actionName, _open, key, defaultNode, _close) {
      return toHeaderValue(
        resolveMacro(
          actionName.sourceString,
          key.sourceString,
          this.args.intermediateObject,
          readMacroDefault(defaultNode),
        ),
      )
    },

    fileMacro(_operator, _actionName, _open, _path, _close) {
      throw new SyntaxError("@f(...) is only supported in body values.")
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return interpolateMacros(
        parseQuotedString(this.sourceString),
        this.args.intermediateObject,
      )
    },

    number(_sign, _digits, _dot, _fraction, _terminator) {
      return Number(this.sourceString)
    },

    boolean(_value, _terminator) {
      return this.sourceString === "true"
    },

    null(_value, _terminator) {
      return null
    },
  })
  // Evaluates a macro's `or <immediate>` default. Defaults are immediate values
  // only (string/number/boolean) — never @i/@env references — so this is
  // independent of the intermediate object and the environment.
  .addOperation<ScopeValue>("toDefaultValue()", {
    macroDefault(_lead, _or, _mid, value, _trail) {
      return value.toDefaultValue()
    },

    macroDefaultValue(value) {
      return value.toDefaultValue()
    },

    string(_open, _chars, _close) {
      return parseQuotedString(this.sourceString)
    },

    defaultNumber(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString)
    },

    defaultBoolean(_value) {
      return this.sourceString === "true"
    },
  })
  .addOperation<JointStepNode>("toJointStep(intermediateObject, cwd)", {
    JointStep(_pickArrow, pickNode, _runArrow, run) {
      const step: JointStepNode = { run: run.toRunTarget() }

      if (pickNode.numChildren > 0) {
        step.pick = pickNode
          .child(0)
          .toPickMap(this.args.intermediateObject, this.args.cwd)
      }

      return step
    },
  })
  .addOperation<Record<string, PickSource>>(
    "toPickMap(intermediateObject, cwd)",
    {
      Pick(_pick, _open, pairs, _close) {
        const pick: Record<string, PickSource> = {}

        for (const pair of pairs.asIteration().children) {
          const [key, source] = pair.toPickPair(
            this.args.intermediateObject,
            this.args.cwd,
          )
          pick[key] = source
        }

        return pick
      },
    },
  )
  .addOperation<[string, PickSource]>("toPickPair(intermediateObject, cwd)", {
    PickPair(key, _colon, source) {
      return [
        key.toKey(),
        source.toPickSource(this.args.intermediateObject, this.args.cwd),
      ]
    },
  })
  .addOperation<PickSource>("toPickSource(intermediateObject, cwd)", {
    PickSource(source) {
      return source.toPickSource(this.args.intermediateObject, this.args.cwd)
    },

    intermediateMacro(_operator, actionName, _open, key, defaultNode, _close) {
      return {
        kind: "value",
        value: resolveMacro(
          actionName.sourceString,
          key.sourceString,
          this.args.intermediateObject,
          readMacroDefault(defaultNode),
        ),
      }
    },

    jsonPath(_first, _dots, _rest) {
      return { kind: "jsonPath", path: this.sourceString }
    },
  })
  .addOperation<string>("toRunTarget()", {
    Run(_run, _open, path, _close) {
      return path.sourceString
    },
  })
  .addOperation<string | undefined>("toTraceId()", {
    Joint(_joint, _open, traceIdNode, _close) {
      return traceIdNode.numChildren > 0
        ? traceIdNode.child(0).toTraceId()
        : undefined
    },

    jointTraceId(value) {
      return value.toTraceId()
    },

    string(_open, _chars, _close) {
      return parseQuotedString(this.sourceString)
    },

    singleQuotedString(_open, _chars, _close) {
      return this.sourceString.slice(1, -1).replace(/\\(['\\])/g, "$1")
    },
  })

export const definitionSemantics = definitionGrammar
  .createSemantics()
  .addOperation("buildItermediateObject(intermediateObject)", {
    Program(items) {
      for (const item of items.children) {
        const [key, value] = item.toEntry()
        this.args.intermediateObject[key] = value
      }

      return this.args.intermediateObject
    },
  })
  .addOperation<[string, ScopeValue]>("toEntry()", {
    DefinitionItem(item) {
      return item.toEntry()
    },

    Entry(key, _colon, value) {
      return [key.toKey(), value.toValue()]
    },

    GraphqlOperation(operationType, _operationHead, _selectionSet) {
      return [operationType.toKey(), this.sourceString.trim()]
    },
  })
  .addOperation<ScopeValue>("toValue()", {
    Object(_open, entries, _close) {
      const object: { [key: string]: ScopeValue } = {}

      for (const entry of entries.children) {
        const [key, value] = entry.toEntry()
        object[key] = value
      }

      return object
    },

    Value(value) {
      return value.toValue()
    },

    Array(_open, values, _close) {
      return values.asIteration().children.map((value) => value.toValue())
    },

    EnvMacro(_operator, actionName, _open, key, defaultNode, _close) {
      return resolveEnvMacro(
        actionName.sourceString,
        key.sourceString,
        readMacroDefault(defaultNode),
      )
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return parseQuotedString(this.sourceString)
    },

    // A bare value may embed @env(...) macros (e.g. `/todos/@env(id or 1)`).
    // Resolve each embedded macro and concatenate it with the literal text.
    bareString(parts) {
      return parts.children
        .map((part) => part.toBareSegment())
        .join("")
        .trim()
    },

    number(_sign, _digits, _dot, _fraction, _terminator) {
      return Number(this.sourceString)
    },

    boolean(_value, _terminator) {
      return this.sourceString === "true"
    },

    null(_value, _terminator) {
      return null
    },
  })
  // Renders one segment of a bare value to its string contribution: literal
  // characters pass through, while an embedded @env(...) macro is resolved and
  // stringified so it can be spliced into the surrounding text.
  .addOperation<string>("toBareSegment()", {
    bareStringPart(part) {
      return part.toBareSegment()
    },

    embeddedMacro(_at, actionName, _open, key, defaultNode, _close) {
      return stringifyMacroValue(
        resolveEnvMacro(
          actionName.sourceString,
          key.sourceString,
          readMacroDefault(defaultNode),
        ),
      )
    },

    bareStringChar(_) {
      return this.sourceString
    },
  })
  .addOperation<string>("toKey()", {
    Key(value) {
      return value.toKey()
    },

    objectKey(_first, _rest) {
      return this.sourceString
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return parseQuotedString(this.sourceString)
    },

    graphqlOperationType(_) {
      return this.sourceString
    },
  })
  // Evaluates an @env(...) macro's `or <immediate>` default — an immediate
  // string/number/boolean value, never a reference.
  .addOperation<ScopeValue>("toDefaultValue()", {
    MacroDefault(_or, value) {
      return value.toDefaultValue()
    },

    embeddedMacroDefault(_sp1, _or, _sp2, value, _sp3) {
      return value.toDefaultValue()
    },

    macroDefaultValue(value) {
      return value.toDefaultValue()
    },

    string(_open, _chars, _close) {
      return parseQuotedString(this.sourceString)
    },

    defaultNumber(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString)
    },

    defaultBoolean(_value) {
      return this.sourceString === "true"
    },
  })

export const buildItermediateObject = (
  refPath: string,
  intermediateObject: IntermediateObject,
  cwd = process.cwd(),
): IntermediateObject => {
  const input = readFileSync(resolve(cwd, refPath), "utf8")
  const matchResult = definitionGrammar.match(input)

  if (matchResult.failed()) {
    throw new SyntaxError(matchResult.message)
  }

  return definitionSemantics(matchResult).buildItermediateObject(
    intermediateObject,
  ) as IntermediateObject
}

// An optional `or <immediate>` default supplied in a macro, e.g. @i(key or 1).
// Wrapped in an object so an absent default is distinguishable from one whose
// value is intentionally null/false/0.
type MacroDefault = { value: ScopeValue } | undefined

// Reads the `macroDefault?` / `MacroDefault?` iteration node into a MacroDefault.
// Returns undefined when no `or <default>` was written.
const readMacroDefault = (defaultNode: Node): MacroDefault =>
  defaultNode.numChildren > 0
    ? { value: defaultNode.child(0).toDefaultValue() }
    : undefined

const resolveMacro = (
  operator: string,
  key: string,
  intermediateObject: IntermediateObject,
  fallback: MacroDefault,
): ScopeValue => {
  if (operator !== "i") {
    throw new ReferenceError(`Unsupported macro operator: ${operator}`)
  }

  const value = key in intermediateObject ? intermediateObject[key] : undefined

  if (value === undefined) {
    if (fallback) {
      return fallback.value
    }

    throw new ReferenceError(`Undefined macro: @${operator}(${key})`)
  }

  return value
}

// Env values supplied via the CLI `-env` JSON argument. They are layered over
// process.env: a key present here wins (replacing a duplicate), while any other
// key falls through to the ambient environment.
let envOverrides: Record<string, string> = {}

/**
 * Parses the `-env` argument — a JSON object string — into an env override map.
 * Values are coerced to strings to match environment-variable semantics (e.g.
 * `{"PORT": 8080}` -> `{ PORT: "8080" }`). Empty/whitespace input yields an
 * empty map. Throws on input that is not a JSON object.
 */
export const parseEnvOverrides = (raw?: string): Record<string, string> => {
  const trimmed = raw?.trim()

  if (!trimmed) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new SyntaxError(`Invalid -env JSON object: ${trimmed}`)
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("-env must be a JSON object.")
  }

  const overrides: Record<string, string> = {}

  for (const [key, value] of Object.entries(parsed)) {
    overrides[key] = typeof value === "string" ? value : JSON.stringify(value)
  }

  return overrides
}

/**
 * Replaces the env overrides consulted by `@env(...)` macros. Pass `{}` to
 * clear them. Merged over process.env at resolve time, duplicates replaced.
 */
export const setEnvOverrides = (overrides: Record<string, string>): void => {
  envOverrides = overrides
}

const resolveEnvMacro = (
  operator: string,
  key: string,
  fallback: MacroDefault,
): ScopeValue => {
  if (operator !== "env") {
    throw new ReferenceError(`Unsupported env macro operator: ${operator}`)
  }

  // `-env` overrides take precedence; otherwise read the ambient environment.
  const envValue = key in envOverrides ? envOverrides[key] : process.env[key]

  if (envValue === undefined) {
    if (fallback) {
      return fallback.value
    }

    throw new ReferenceError(`Undefined env macro: @${operator}(${key})`)
  }

  return envValue
}

const resolveFileMacro = (filePath: string, cwd: string): Blob => {
  const resolvedPath = resolve(cwd, filePath)

  return new Blob([readFileSync(resolvedPath)])
}

const parseQuotedString = (source: string): string => {
  return JSON.parse(
    source.replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\r"),
  )
}

const interpolateMacros = (
  value: string,
  intermediateObject: IntermediateObject,
): string => {
  return value.replace(
    /@([A-Za-z][A-Za-z0-9_-]*)\(([^)]+)\)/g,
    (source, operator, key) => {
      // Interpolated string macros (e.g. "hi @i(name)") do not support `or`
      // defaults — those are only available in value position.
      const resolvedValue = resolveMacro(
        operator,
        key,
        intermediateObject,
        undefined,
      )

      return stringifyMacroValue(resolvedValue)
    },
  )
}

// Renders a macro's resolved value for splicing into surrounding text. Mirrors
// the coercion used when interpolating @i(...) macros so embedded @env(...)
// macros stringify consistently.
const stringifyMacroValue = (value: ScopeValue): string => {
  if (value === null) {
    return "null"
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  return String(value)
}

const toHeaderValue = (value: ScopeValue): HeaderValue => {
  if (typeof value === "object" && value !== null) {
    throw new TypeError("Header macro values must resolve to primitive values.")
  }

  return value
}

export const compile = (
  input: string,
  options: CompileOptions = {},
): CompileResult => {
  const matchResult = scriptGrammar.match(input)

  if (matchResult.failed()) {
    // The Program alternation reports the failure of whichever alternative got
    // furthest, which for a broken joint file is often the unrelated
    // RequestProgram rule. Re-match against JointProgram directly so the error
    // points at the actual joint syntax problem.
    if (input.includes("@joint")) {
      const jointMatchResult = scriptGrammar.match(input, "JointProgram")

      if (jointMatchResult.failed()) {
        throw new SyntaxError(
          `Invalid @joint file: ${jointMatchResult.message}`,
        )
      }
    }

    throw new SyntaxError(matchResult.message)
  }

  return semantics(matchResult).compile(
    options.cwd ?? process.cwd(),
  ) as CompileResult
}

export enum CompileSourceType {
  File = "file",
  Raw = "raw",
}

export const compileFile = (
  source: string,
  type: CompileSourceType,
): CompileResult => {
  if (type === CompileSourceType.Raw) {
    return compile(source, {
      cwd: process.cwd(),
    })
  }

  const absoluteFilePath = resolve(process.cwd(), source)
  const input = readFileSync(absoluteFilePath, "utf8")

  return compile(input, {
    cwd: dirname(absoluteFilePath),
  })
}
