import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { definitionGrammar, scriptGrammar } from "./lexer.ts"

export type ScopeValue =
  | string
  | number
  | boolean
  | null
  | ScopeValue[]
  | { [key: string]: ScopeValue }

export interface ScopeObject {
  refs?: string[]
  url?: string
  method?: string
  headers: Record<string, string | number | boolean | null>
  body?: { [key: string]: ScopeValue }
}

export interface IntermediateObject {
  [key: string]: ScopeValue
}

export const semantics = scriptGrammar
  .createSemantics()
  .addOperation("compile()", {
    Program(refs, statements) {
      const headersObject: ScopeObject["headers"] = {}
      const intermediateObject: IntermediateObject = {}
      const scopeObject: ScopeObject = {
        headers: headersObject,
      }

      for (const ref of refs.children) {
        ref.buildItermediateObject(intermediateObject)
      }

      for (const statement of statements.children) {
        statement.compileStatement(scopeObject, headersObject)
      }

      scopeObject.headers = headersObject
      return scopeObject
    },
  })
  .addOperation("compileStatement(scopeObject, headersObject)", {
    Statement(statement) {
      statement.compileStatement(this.args.scopeObject, this.args.headersObject)
    },

    Url(_url, value) {
      this.args.scopeObject.url = value.toValue()
    },

    Type(_type, method) {
      this.args.scopeObject.method = method.sourceString
    },

    Authorization(_keyword, scheme, credentials) {
      this.args.headersObject.authorization = `${scheme.sourceString} ${credentials.sourceString.trim()}`
    },

    Header(_header, key, _comma, value) {
      this.args.headersObject[key.sourceString] = value.toHeaderValue()
    },

    Body(_body, value) {
      this.args.scopeObject.body = value.toValue()
    },
  })
  .addOperation("buildItermediateObject(intermediateObject)", {
    Ref(_ref, path) {
      buildItermediateObject(path.sourceString, this.args.intermediateObject)
    },
  })
  .addOperation<ScopeValue>("toValue()", {
    Object(_open, pairs, _close) {
      const object: { [key: string]: ScopeValue } = {}

      for (const pair of pairs.children) {
        const [key, value] = pair.toPair()
        object[key] = value
      }

      return object
    },

    Pair(key, _colon, value) {
      return [key.toKey(), value.toValue()] as [string, ScopeValue]
    },

    Key(value) {
      return value.toKey()
    },

    Value(value) {
      return value.toValue()
    },

    Array(_open, values, _close) {
      return values.asIteration().children.map((value) => value.toValue())
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes and escapes; JSON.parse returns the actual string value.
      return JSON.parse(this.sourceString)
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
  .addOperation<[string, ScopeValue]>("toPair()", {
    Pair(key, _colon, value) {
      return [key.toKey(), value.toValue()]
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
      // sourceString includes quotes and escapes; JSON.parse returns the actual string value.
      return JSON.parse(this.sourceString)
    },
  })
  .addOperation<string | number | boolean | null>("toHeaderValue()", {
    headerValue(value) {
      return value.toHeaderValue()
    },

    bareHeaderValue(_) {
      return this.sourceString.trim()
    },

    string(_open, _chars, _close) {
      // sourceString includes quotes and escapes; JSON.parse returns the actual string value.
      return JSON.parse(this.sourceString)
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

    string(_open, _chars, _close) {
      // sourceString includes quotes and escapes; JSON.parse returns the actual string value.
      return JSON.parse(this.sourceString)
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
      // sourceString includes quotes and escapes; JSON.parse returns the actual string value.
      return JSON.parse(this.sourceString)
    },
  })

export function buildItermediateObject(
  refPath: string,
  intermediateObject: IntermediateObject,
): IntermediateObject {
  const input = readFileSync(resolve(process.cwd(), refPath), "utf8")
  const matchResult = definitionGrammar.match(input)

  if (matchResult.failed()) {
    throw new SyntaxError(matchResult.message)
  }

  return definitionSemantics(matchResult).buildItermediateObject(
    intermediateObject,
  ) as IntermediateObject
}

export function compile(input: string): ScopeObject {
  const matchResult = scriptGrammar.match(input)

  if (matchResult.failed()) {
    throw new SyntaxError(matchResult.message)
  }

  return semantics(matchResult).compile() as ScopeObject
}
