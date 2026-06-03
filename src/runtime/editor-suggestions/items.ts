export type EditorSuggestionKind =
  | "keyword"
  | "macro"
  | "definition"
  | "ref"
  | "header"
  | "bodyKey"

export type EditorSuggestionItem = {
  label: string
  insertText: string
  cursorOffset?: number
  kind: EditorSuggestionKind
}

export const requestKeywordSuggestions: EditorSuggestionItem[] = [
  "ref",
  "url",
  "type",
  "header",
  "authorization",
  "auth",
  "body",
].map((keyword) => ({
  label: keyword,
  insertText: `${keyword} `,
  kind: "keyword",
}))

export const requestMacroSuggestions: EditorSuggestionItem[] = [
  {
    label: "@i",
    insertText: "@i()",
    cursorOffset: 3,
    kind: "macro",
  },
  {
    label: "@f",
    insertText: "@f()",
    cursorOffset: 3,
    kind: "macro",
  },
  {
    label: "@env",
    insertText: "@env()",
    cursorOffset: 5,
    kind: "macro",
  },
]

export const requestHeaderSuggestions: EditorSuggestionItem[] = [
  "accept",
  "accept-encoding",
  "accept-language",
  "authorization",
  "cache-control",
  "content-encoding",
  "content-language",
  "content-length",
  "content-type",
  "cookie",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "origin",
  "prefer",
  "range",
  "referer",
  "user-agent",
  "x-api-key",
  "x-correlation-id",
  "x-csrf-token",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-idempotency-key",
  "x-request-id",
].map((header) => ({
  label: header,
  insertText: `${header}, `,
  kind: "header",
}))

export const buildCustomSuggestionItems = (
  customSuggestions: string[],
): EditorSuggestionItem[] => {
  return [...new Set(customSuggestions)].flatMap((customSuggestion) => [
    {
      label: customSuggestion,
      insertText: `${customSuggestion}, `,
      kind: "header" as const,
    },
    {
      label: customSuggestion,
      insertText: `${customSuggestion}: `,
      kind: "bodyKey" as const,
    },
  ])
}
