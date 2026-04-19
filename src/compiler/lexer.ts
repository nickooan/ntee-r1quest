import * as Ohm from "ohm-js";

export const scriptGrammarSource = await Bun.file(
  new URL("./script-grammar.ohm", import.meta.url),
).text();

export const scriptGrammar = Ohm.grammar(scriptGrammarSource);

export default scriptGrammar;
