import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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
    Program(refs, requestStatements, headerStatements, body) {
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
  .addOperation("compileStatement(scopeObject, headersObject, intermediateObject, cwd)", {
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
      this.args.headersObject.authorization =
        `${scheme.sourceString} ${interpolateMacros(
          credentials.sourceString.trim(),
          this.args.intermediateObject,
        )}`
    },

    Header(_header, key, _comma, value) {
      this.args.headersObject[key.sourceString.toLowerCase()] = value.toHeaderValue(
        this.args.intermediateObject,
        this.args.cwd,
      )
    },

    Body(_body, value) {
      this.args.scopeObject.body = value.toValue(
        this.args.intermediateObject,
        this.args.cwd,
      )
    },
  })
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
      const compiledValue = value.toValue(this.args.intermediateObject, this.args.cwd)

      if (value.getMacroActionName() === "f") {
        return [key.toKey(), [compiledValue]] as [string, ScopeValue]
      }

      return [
        key.toKey(),
        compiledValue,
      ] as [string, ScopeValue]
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

    intermediateMacro(_operator, actionName, _open, key, _close) {
      return resolveMacro(
        actionName.sourceString,
        key.sourceString,
        this.args.intermediateObject,
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

    number(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString)
    },

    boolean(_) {
      return this.sourceString === "true"
    },

    null(_) {
      return null
    },
  })
  .addOperation<[string, ScopeValue]>("toPair(intermediateObject, cwd)", {
    Pair(key, _colon, value) {
      const compiledValue = value.toValue(this.args.intermediateObject, this.args.cwd)

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

    intermediateMacro(_operator, actionName, _open, _key, _close) {
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

    number(_sign, _digits, _dot, _fraction) {
      return undefined
    },

    boolean(_) {
      return undefined
    },

    null(_) {
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

    intermediateMacro(_operator, actionName, _open, key, _close) {
      return toHeaderValue(
        resolveMacro(
          actionName.sourceString,
          key.sourceString,
          this.args.intermediateObject,
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

    number(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString)
    },

    boolean(_) {
      return this.sourceString === "true"
    },

    null(_) {
      return null
    },
  })

export const definitionSemantics = definitionGrammar
  .createSemantics()
  .addOperation("buildItermediateObject(intermediateObject)", {
    Program(entries) {
      for (const entry of entries.children) {
        const [key, value] = entry.toEntry()
        this.args.intermediateObject[key] = value
      }

      return this.args.intermediateObject
    },
  })
  .addOperation<[string, ScopeValue]>("toEntry()", {
    Entry(key, _colon, value) {
      return [key.toKey(), value.toValue()]
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

    EnvMacro(_operator, _actionName, _open, key, _close) {
      const envValue = process.env[key.sourceString]

      if (envValue === undefined) {
        throw new ReferenceError(`Undefined env macro: @env(${key.sourceString})`)
      }

      return envValue
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes, escapes, and may include raw newlines.
      return parseQuotedString(this.sourceString)
    },

    bareString(_) {
      return this.sourceString.trim()
    },

    number(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString)
    },

    boolean(_) {
      return this.sourceString === "true"
    },

    null(_) {
      return null
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

const resolveMacro = (
  operator: string,
  key: string,
  intermediateObject: IntermediateObject,
): ScopeValue => {
  if (operator !== "i") {
    throw new ReferenceError(`Unsupported macro operator: ${operator}`)
  }

  if (!(key in intermediateObject)) {
    throw new ReferenceError(`Undefined macro: @${operator}(${key})`)
  }

  const value = intermediateObject[key]

  if (value === undefined) {
    throw new ReferenceError(`Undefined macro: @${operator}(${key})`)
  }

  return value
}

const resolveFileMacro = (filePath: string, cwd: string): Blob => {
  return Bun.file(resolve(cwd, filePath))
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
  return value.replace(/@([A-Za-z][A-Za-z0-9_-]*)\(([^)]+)\)/g, (
    source,
    operator,
    key,
  ) => {
    const resolvedValue = resolveMacro(operator, key, intermediateObject)

    if (resolvedValue === null) {
      return "null"
    }

    if (typeof resolvedValue === "object") {
      return JSON.stringify(resolvedValue)
    }

    return String(resolvedValue)
  })
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
): ScopeObject => {
  const matchResult = scriptGrammar.match(input)

  if (matchResult.failed()) {
    throw new SyntaxError(matchResult.message)
  }

  return semantics(matchResult).compile(options.cwd ?? process.cwd()) as ScopeObject
}

export enum CompileSourceType {
  File = "file",
  Raw = "raw",
}

export const compileFile = (
  source: string,
  type: CompileSourceType,
): ScopeObject => {
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
