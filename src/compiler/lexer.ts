import * as Ohm from "ohm-js";

export const grammarSource = await Bun.file(
  new URL("./grammar.ohm", import.meta.url),
).text();

export const grammar = Ohm.grammar(grammarSource);

export default grammar;
