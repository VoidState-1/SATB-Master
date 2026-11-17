import { applyFunctionalDefinition, applyFunctionalForm, applyFunctionalTarget, FUNCTIONAL_BASE_DEFINITIONS } from "../functionalHarmonyCatalog";
import { functionalTargetForDegree, type ChordDraft, type ChordQuality, type ScaleDegree } from "../chordModel";
import type { KeyMode } from "../pitch";
import { fail, type SourceLocation } from "./types";

const degrees = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function chordDraft(symbol: string, mode: KeyMode, location?: SourceLocation): ChordDraft {
  let draft: ChordDraft = { degree: 1, degreeAlteration: 0, quality: "major", inversion: 0, source: "manual", confidence: "certain" };
  const targetMatch = /\/(VII|III|VI|IV|II|V|I)$/.exec(symbol);
  const baseSymbol = targetMatch ? symbol.slice(0, targetMatch.index) : symbol;
  const definition = [...FUNCTIONAL_BASE_DEFINITIONS].sort((a, b) => b.id.length - a.id.length)
    .find((item) => baseSymbol.startsWith(item.id) && /^(?:|6|64|46|6\/4|7|65|6\/5|43|4\/3|42|4\/2|2|9)$/.test(baseSymbol.slice(item.id.length)));
  let figures: string;
  if (definition) {
    draft = applyFunctionalDefinition(draft, definition, mode);
    figures = baseSymbol.slice(definition.id.length);
    const form = figures === "9" ? "ninth" : /^(7|65|6\/5|43|4\/3|42|4\/2|2)$/.test(figures) ? "seventh" : "triad";
    if (!definition.forms.includes(form)) fail(`和弦 ${symbol} 不支持 ${form} 结构`, location);
    draft = applyFunctionalForm(draft, definition, form, mode);
  } else {
    const match = /^([#b]?)(VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)([o°+ø]?)(64|6\/4|6|7|65|6\/5|43|4\/3|42|4\/2|2|9)?$/.exec(baseSymbol);
    if (!match) fail(`未知和弦 ${symbol}；使用 T、D7、I64、ii6 等功能或级数标记`, location);
    const degree = (degrees.indexOf(match[2].toUpperCase()) + 1) as ScaleDegree;
    figures = match[4] ?? "";
    const seventh = /^(7|65|6\/5|43|4\/3|42|4\/2|2|9)$/.test(figures);
    let quality: ChordQuality = match[2] === match[2].toUpperCase() ? "major" : "minor";
    if (match[3] === "o" || match[3] === "°") quality = "diminished";
    if (match[3] === "+") quality = "augmented";
    if (seventh) {
      if (match[3] === "ø") quality = "halfDiminished7";
      else if (quality === "diminished") quality = "diminished7";
      else if (quality === "major") quality = degree === 5 ? "dominant7" : "major7";
      else if (quality === "minor") quality = "minor7";
      else fail(`不支持的七和弦 ${symbol}`, location);
    } else if (match[3] === "ø") fail("半减符号需要七和弦标记", location);
    draft = {
      ...draft, degree, quality,
      degreeAlteration: match[1] === "#" ? 1 : match[1] === "b" ? -1 : 0,
      extensions: figures === "9" ? [9] : [],
      designation: {
        notationSystem: "spasobin",
        kind: [1, 4, 5].includes(degree) ? "primary" : "side-degree",
        primaryFunction: degree === 1 || degree === 6 ? "tonic" : degree === 2 || degree === 4 ? "subdominant" : "dominant",
        ...(degree === 3 ? { secondaryFunction: "tonic" as const } : degree === 6 ? { secondaryFunction: "subdominant" as const } : {}),
      },
    };
  }
  const inversion = /^(64|46|6\/4|43|4\/3)$/.test(figures) ? 2
    : /^(6|65|6\/5)$/.test(figures) ? 1 : /^(42|4\/2|2)$/.test(figures) ? 3 : undefined;
  if (inversion !== undefined) {
    if (definition?.fixedInversion !== undefined && definition.fixedInversion !== inversion)
      fail(`和弦 ${definition.id} 的转位固定`, location);
    draft.inversion = inversion;
  }
  if (targetMatch) {
    if (![5, 7].includes(draft.degree)) fail("副属目标只能用于 V 或 VII 级和弦", location);
    draft = applyFunctionalTarget(draft, functionalTargetForDegree((degrees.indexOf(targetMatch[1]) + 1) as ScaleDegree));
  }
  return draft;
}
