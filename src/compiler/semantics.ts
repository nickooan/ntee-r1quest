import { grammar } from "./lexer.ts";

export type ScopeValue =
  | string
  | number
  | boolean
  | null
  | ScopeValue[]
  | { [key: string]: ScopeValue };

export interface ScopeObject {
  url?: string;
  method?: string;
  headers: Record<string, string | number | boolean | null>;
  body?: { [key: string]: ScopeValue };
}

export const semantics = grammar
  .createSemantics()
  .addOperation("compile()", {
    Program(statements) {
      const headersObject: ScopeObject["headers"] = {};
      const scopeObject: ScopeObject = {
        headers: headersObject,
      };

      for (const statement of statements.children) {
        statement.compileStatement(scopeObject, headersObject);
      }

      scopeObject.headers = headersObject;
      return scopeObject;
    },
  })
  .addOperation("compileStatement(scopeObject, headersObject)", {
    Statement(statement) {
      statement.compileStatement(this.args.scopeObject, this.args.headersObject);
    },

    Url(_url, value) {
      this.args.scopeObject.url = value.toValue();
    },

    Type(_type, method) {
      this.args.scopeObject.method = method.sourceString;
    },

    Authorization(_keyword, scheme, credentials) {
      this.args.headersObject.authorization =
        `${scheme.sourceString} ${credentials.sourceString.trim()}`;
    },

    Header(_header, key, _comma, value) {
      this.args.headersObject[key.sourceString] = value.toHeaderValue();
    },

    Body(_body, value) {
      this.args.scopeObject.body = value.toValue();
    },
  })
  .addOperation<ScopeValue>("toValue()", {
    Object(_open, pairs, _close) {
      const object: { [key: string]: ScopeValue } = {};

      for (const pair of pairs.children) {
        const [key, value] = pair.toPair();
        object[key] = value;
      }

      return object;
    },

    Pair(key, _colon, value) {
      return [key.toKey(), value.toValue()] as [string, ScopeValue];
    },

    Key(value) {
      return value.toKey();
    },

    Value(value) {
      return value.toValue();
    },

    Array(_open, values, _close) {
      return values.asIteration().children.map((value) => value.toValue());
    },

    string(_open, _chars, _close) {
      return JSON.parse(this.sourceString);
    },

    number(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString);
    },

    boolean(_) {
      return this.sourceString === "true";
    },

    null(_) {
      return null;
    },
  })
  .addOperation<[string, ScopeValue]>("toPair()", {
    Pair(key, _colon, value) {
      return [key.toKey(), value.toValue()];
    },
  })
  .addOperation<string>("toKey()", {
    Key(value) {
      return value.toKey();
    },

    identifier(_first, _rest) {
      return this.sourceString;
    },

    string(_open, _chars, _close) {
      return JSON.parse(this.sourceString);
    },
  })
  .addOperation<string | number | boolean | null>("toHeaderValue()", {
    headerValue(value) {
      return value.toHeaderValue();
    },

    bareHeaderValue(_) {
      return this.sourceString.trim();
    },

    string(_open, _chars, _close) {
      return JSON.parse(this.sourceString);
    },

    number(_sign, _digits, _dot, _fraction) {
      return Number(this.sourceString);
    },

    boolean(_) {
      return this.sourceString === "true";
    },

    null(_) {
      return null;
    },
  });

export function compile(input: string): ScopeObject {
  const matchResult = grammar.match(input);

  if (matchResult.failed()) {
    throw new SyntaxError(matchResult.message);
  }

  return semantics(matchResult).compile() as ScopeObject;
}
