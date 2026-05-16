import { readFileSync } from "node:fs"
import * as Ohm from "ohm-js"

const scriptGrammarSource = readFileSync(
  new URL("./script-grammar.ohm", import.meta.url),
  "utf8",
)
const definitionGrammarSource = readFileSync(
  new URL("./definition-grammar.ohm", import.meta.url),
  "utf8",
)

export const scriptGrammar = Ohm.grammar(scriptGrammarSource)
export const definitionGrammar = Ohm.grammar(definitionGrammarSource)
