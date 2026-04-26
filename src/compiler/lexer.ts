import * as Ohm from "ohm-js";
import scriptGrammarSource from "./script-grammar.ohm" with { type: "text" };
import definitionGrammarSource from "./definition-grammar.ohm" with { type: "text" };

export const scriptGrammar = Ohm.grammar(scriptGrammarSource);
export const definitionGrammar = Ohm.grammar(definitionGrammarSource);
