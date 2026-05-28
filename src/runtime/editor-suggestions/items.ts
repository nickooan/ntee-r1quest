export type EditorSuggestionKind = "keyword" | "macro" | "definition" | "ref"

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
