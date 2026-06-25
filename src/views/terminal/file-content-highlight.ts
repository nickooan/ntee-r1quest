// Pure syntax highlighting and file-pane geometry, extracted from
// file-content.tsx so the (sizable) highlighting logic ports to Go independently
// of the Ink rendering. No React. `HighlightSegment.color` is a plain string
// (an Ink color name); the renderer passes it straight to <Text color=...>.

export type FilePaneLayout = {
  contentWidth: number
  contentHeight: number
  lineNumberWidth: number
}

export type HighlightSegment = {
  text: string
  color?: string
  bold?: boolean
  dimColor?: boolean
}

export type HighlightLanguage = "r1quest" | "graphql"

const paddingX = 1
const syntaxPattern =
  /(@)(i|f|env)(\([^)]*\))|\b(true|false|null)\b|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\/\/.*$/g
// Tokens highlighted inside a macro's parentheses: the `or` default keyword and
// the immediate default value (string/number/boolean).
const macroArgsPattern =
  /\bor\b|"(?:\\.|[^"\\])*"|\b(true|false)\b|-?\d+(?:\.\d+)?/g
// A macro embedded inside a string value, e.g. "/todos/@i(id)". Only plain
// @i(key) interpolates inside strings — @env/@f and `or` defaults do not work
// there — so only that form is highlighted; anything else stays string text.
const stringMacroPattern = /(@)(i)(\([A-Za-z][A-Za-z0-9_-]*\))/g
const keywordPattern = /^(\s*)(ref|url|type|header|authorization|auth|body)\b/
const graphqlStartPattern = /^\s*(query|mutation)\s*:\s*(?:"|$)/
const graphqlSugarStartPattern = /^\s*(query|mutation)\b(?!\s*:)/
const graphqlStringStartPattern = /^\s*"/
const graphqlSyntaxPattern =
  /#.*$|"(?:\\.|[^"\\])*"|\$[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*|\b(query|mutation|subscription|fragment|on|true|false|null)\b|-?\d+(?:\.\d+)?|[!$():=@{}\[\],|]/g

const hasClosingUnescapedQuote = (
  line: string,
  startIndex: number,
): boolean => {
  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] !== '"') {
      continue
    }

    let slashCount = 0

    for (
      let slashIndex = index - 1;
      slashIndex >= 0 && line[slashIndex] === "\\";
      slashIndex -= 1
    ) {
      slashCount += 1
    }

    if (slashCount % 2 === 0) {
      return true
    }
  }

  return false
}

const getGraphqlBraceDelta = (line: string): number => {
  let delta = 0
  let insideString = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (insideString) {
      if (char === "\\" && index + 1 < line.length) {
        index += 1
      } else if (char === '"') {
        insideString = false
      }

      continue
    }

    if (char === "#") {
      break
    }

    if (char === '"') {
      insideString = true
    } else if (char === "{") {
      delta += 1
    } else if (char === "}") {
      delta -= 1
    }
  }

  return delta
}

export const buildGraphqlHighlightLines = (lines: string[]): Set<number> => {
  const graphqlLines = new Set<number>()
  let pendingGraphqlValue = false
  let insideGraphqlString = false
  let insideGraphqlSugarBlock = false
  let graphqlSugarBraceDepth = 0

  lines.forEach((line, lineIndex) => {
    if (insideGraphqlSugarBlock) {
      graphqlLines.add(lineIndex)
      graphqlSugarBraceDepth += getGraphqlBraceDelta(line)

      if (graphqlSugarBraceDepth <= 0) {
        insideGraphqlSugarBlock = false
        graphqlSugarBraceDepth = 0
      }

      return
    }

    if (insideGraphqlString) {
      graphqlLines.add(lineIndex)

      if (hasClosingUnescapedQuote(line, 0)) {
        insideGraphqlString = false
      }

      return
    }

    if (pendingGraphqlValue) {
      if (!line.trim()) {
        return
      }

      pendingGraphqlValue = false

      if (!graphqlStringStartPattern.test(line)) {
        return
      }

      graphqlLines.add(lineIndex)

      const quoteIndex = line.indexOf('"')

      if (!hasClosingUnescapedQuote(line, quoteIndex + 1)) {
        insideGraphqlString = true
      }

      return
    }

    if (graphqlSugarStartPattern.test(line)) {
      graphqlLines.add(lineIndex)
      graphqlSugarBraceDepth = getGraphqlBraceDelta(line)

      if (graphqlSugarBraceDepth > 0) {
        insideGraphqlSugarBlock = true
      } else {
        graphqlSugarBraceDepth = 0
      }

      return
    }

    const graphqlStartMatch = line.match(graphqlStartPattern)

    if (!graphqlStartMatch) {
      return
    }

    const quoteIndex = line.indexOf('"')

    if (quoteIndex === -1) {
      pendingGraphqlValue = true
      return
    }

    graphqlLines.add(lineIndex)

    if (!hasClosingUnescapedQuote(line, quoteIndex + 1)) {
      insideGraphqlString = true
    }
  })

  return graphqlLines
}

export const buildFilePaneLayout = (
  width: number,
  height: number,
  lineCount = 1,
): FilePaneLayout => {
  const contentHeight = Math.max(1, height - 2)
  const lineNumberWidth = String(Math.max(lineCount, contentHeight)).length
  const gutterWidth = lineNumberWidth + 2
  const contentWidth = Math.max(1, width - 2 - paddingX * 2 - gutterWidth)

  return {
    contentWidth,
    contentHeight,
    lineNumberWidth,
  }
}

const highlightGraphqlLine = (line: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of line.matchAll(graphqlSyntaxPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start > cursor) {
      segments.push({ text: line.slice(cursor, start) })
    }

    if (token.startsWith("#")) {
      segments.push({ text: token, dimColor: true })
    } else if (token.startsWith('"')) {
      segments.push({ text: token, color: "yellow" })
    } else if (token.startsWith("$")) {
      segments.push({ text: token, color: "green", bold: true })
    } else if (token.startsWith("@")) {
      segments.push({ text: token, color: "red", bold: true })
    } else if (match[1]) {
      segments.push({ text: token, color: "cyan", bold: true })
    } else if (/^-?\d/.test(token)) {
      segments.push({ text: token, color: "blue" })
    } else {
      segments.push({ text: token, dimColor: true })
    }

    cursor = start + token.length
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor) })
  }

  return segments
}

// Sub-highlights a macro's parenthesized arguments, e.g. (key or "default"):
// the `or` keyword and the immediate default value are coloured, while the key
// and punctuation keep the default colour, as before.
const highlightMacroArgs = (args: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of args.matchAll(macroArgsPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start > cursor) {
      segments.push({ text: args.slice(cursor, start) })
    }

    if (token === "or") {
      segments.push({ text: token, color: "cyan", bold: true })
    } else if (token.startsWith('"')) {
      segments.push({ text: token, color: "yellow" })
    } else if (match[1]) {
      segments.push({ text: token, color: "magenta" })
    } else {
      segments.push({ text: token, color: "blue" })
    }

    cursor = start + token.length
  }

  if (cursor < args.length) {
    segments.push({ text: args.slice(cursor) })
  }

  return segments
}

// Highlights a string value (including its quotes), sub-highlighting any macros
// embedded in it (e.g. a URL "/todos/@env(id or 1)") while the surrounding text
// keeps the string colour.
const highlightString = (token: string): HighlightSegment[] => {
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const match of token.matchAll(stringMacroPattern)) {
    const start = match.index ?? 0
    const [whole, at, action, args] = match

    if (at === undefined || action === undefined || args === undefined) {
      continue
    }

    if (start > cursor) {
      segments.push({ text: token.slice(cursor, start), color: "yellow" })
    }

    segments.push({ text: at, color: "red", bold: true })
    segments.push({ text: action, color: "green", bold: true })
    // No `or` defaults are valid inside strings, so the args are a plain key.
    segments.push({ text: args })

    cursor = start + whole.length
  }

  if (cursor < token.length) {
    segments.push({ text: token.slice(cursor), color: "yellow" })
  }

  return segments
}

export const highlightLine = (
  line: string,
  language: HighlightLanguage = "r1quest",
): HighlightSegment[] => {
  if (language === "graphql") {
    return highlightGraphqlLine(line)
  }

  const segments: HighlightSegment[] = []
  const keywordMatch = line.match(keywordPattern)
  const keywordStart = keywordMatch?.[1]?.length ?? -1
  const keywordEnd =
    keywordMatch && keywordMatch[2] ? keywordStart + keywordMatch[2].length : -1
  let cursor = keywordEnd === -1 ? 0 : keywordEnd

  if (keywordEnd !== -1) {
    if (keywordStart > 0) {
      segments.push({ text: line.slice(0, keywordStart) })
    }

    segments.push({
      text: line.slice(keywordStart, keywordEnd),
      color: "cyan",
      bold: true,
    })
  }

  for (const match of line.matchAll(syntaxPattern)) {
    const start = match.index ?? 0
    const token = match[0]

    if (start < cursor) {
      continue
    }

    if (start > cursor) {
      segments.push({ text: line.slice(cursor, start) })
    }

    if (match[1] && match[2] && match[3]) {
      segments.push({ text: match[1], color: "red", bold: true })
      segments.push({ text: match[2], color: "green", bold: true })
      segments.push(...highlightMacroArgs(match[3]))
    } else if (match[4]) {
      segments.push({ text: token, color: "magenta" })
    } else if (token.startsWith('"')) {
      segments.push(...highlightString(token))
    } else if (token.startsWith("//")) {
      segments.push({ text: token, dimColor: true })
    } else {
      segments.push({ text: token, color: "blue" })
    }

    cursor = start + token.length
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor) })
  }

  return segments
}

export { paddingX }
