import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { augmentedIntervalRule } from "./melody";

const supertonic = `satb 1
key B major
meter 3/2
bars 1..1 {
 S: | E5/2 C#5/2 B4/2 |
 A: | C#4/2 E4/2 D#4/2 |
 T: | G#3/2 G3/2 F#3/2 |
 B: | E3/1 F#2/2 |
}
annotations {
 chord natural range=[1:1,1:2) symbol=ii6
 chord lowered range=[1:2,1:3) symbol=iio6
 chord cadence range=[1:3,2:1) symbol=K46
}`;
const subdominant = `satb 1
key B major
meter 3/2
bars 1..1 {
 S: | B4/1 B4/2 |
 A: | E4/1 D#4/2 |
 T: | B3/2 E3/2 F#3/2 |
 B: | G#2/2 G2/2 F#2/2 |
 H: | IV6/2 iv6/2 K46/2 |
}`;
const rule = "melody.augmented-interval";
function result(text: string, voice: string, boundary?: number) {
  const { project } = compileScoreText(text);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "cut", tick: boundary, source: "manual", confidence: "certain",
  });
  const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const atEntry = (d: {ruleId: string; tick: number; voiceIds: readonly string[]}) =>
    d.ruleId === rule && d.tick === 1920 && d.voiceIds.includes(voice);
  return [
    augmentedIntervalRule(rules).some(atEntry),
    checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } }).diagnostics.some(atEntry),
  ];
}

describe("natural to harmonic major subdominant sixths", () => {
  it("checks the tenor of ii6 and the bass of IV6", () => {
    expect(result(supertonic, "tenor")).toEqual([false, false]);
    expect(result(subdominant, "bass")).toEqual([false, false]);
  });
  it.each([
    ["wrong target pitch", supertonic.replace("F#3/2 |", "D#3/2 |")],
    ["wrong octave", supertonic.replace("F#3/2 |", "F#4/2 |")],
    ["a different voice takes over the descending step", supertonic.replace("F#3/2 |", "D#3/2 |").replace("D#4/2 |", "F#4/2 |")],
    ["different subdominant identity", supertonic.replace("symbol=iio6", "symbol=iv")],
    ["missing middle root", supertonic.replace("C#5/2", "E5/2")],
    ["ordinary six-four", supertonic.replace("symbol=K46", "symbol=I64")],
    ["different local key", supertonic.replace("symbol=iio6", 'symbol=iio6 localKey="A major"')],
    ["nonchord role", supertonic.replace(" chord natural", " note T@1:2 role=passing\n chord natural")],
  ])("%s keeps the tenor warning", (_, text) => expect(result(text, "tenor")).toEqual([true, true]));
  it.each([1920, 3840])("does not span a phrase boundary at %i", cut => {
    expect(result(supertonic, "tenor", cut)).toEqual([true, true]);
  });
});
