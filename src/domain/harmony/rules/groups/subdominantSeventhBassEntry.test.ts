import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { augmentedIntervalRule } from "./melody";

const exercise = `satb 1
key C minor
meter 6/8
bars 1..2 {
 S: | C5/4. A4/4. | G4/4. F4/4. |
 A: | Eb4/4. D4/4. | Eb4/4. D4/4. |
 T: | A3/2. | C4/4. B3/4. |
 B: | F3/8 F#3/8~ F#3/2 | G3/2. |
}
annotations {
 chord v range=[2:4,3:1) symbol=V7
}`;
const nameChain = ` chord dd range=[1:2,1:4) symbol=viio7/V
 chord dd6 range=[1:4,2:1) symbol=V6/V
 chord k range=[2:1,2:4) symbol=K46
`;
const named = exercise.replace(" chord v", nameChain + " chord v");
const rule = "melody.augmented-interval";
function result(input: string | ProjectDocument, boundary?: number, voice = "bass", tick = 480) {
  const project = typeof input === "string" ? compileScoreText(input).project : input;
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "cut", tick: boundary, source: "manual", confidence: "certain",
  });
  const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const atEntry = (d: {ruleId: string; tick: number; voiceIds: readonly string[]}) =>
    d.ruleId === rule && d.tick === tick && d.voiceIds.includes(voice);
  return [
    augmentedIntervalRule(rules).some(atEntry),
    checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } }).diagnostics.some(atEntry),
  ];
}

describe("bass raises the subdominant seventh's root into a sustained leading tone of V", () => {
  it.each([exercise, named])("accepts complete written DD sonorities and their real dominant", text => {
    expect(result(text)).toEqual([false, false]);
  });
  it("accepts the direct dominant route", () => {
    const text = named.replace("Eb4/4. D4/4. |\n T:", "D4/4. D4/4. |\n T:")
      .replace("C4/4. B3/4.", "B3/4. B3/4.").replace("symbol=K46", "symbol=V");
    expect(result(text)).toEqual([false, false]);
  });
  it.each([
    ["upper voice reattacks at the bass alteration", exercise.replace("C5/4.", "C5/8 C5/4")],
    ["actual chord member missing under a DD label", named.replace("A4/4. |", "B4/4. |")],
    ["a new bass note interrupts the held chain", named.replace("F#3/8~ F#3/2", "F#3/8 F#3/2")],
    ["bass resolves in another register", exercise.replace("G3/2.", "G2/2.")],
    ["bass fails to reach V", exercise.replace("G3/2.", "A3/2.")],
    ["cadential sonority lacks its third", exercise.replace("| Eb4/4. D4/4. |\n T:", "| G4/4. D4/4. |\n T:")],
    ["dominant missing after an apparent six-four", exercise.replace("F4/4. |", "Eb4/4. |")],
    ["conflicting internal target", named.replace("V6/V", "V6/II")],
    ["ordinary tonic inversion", named.replace("symbol=K46", "symbol=i64")],
    ["named dominant in a conflicting key", exercise.replace("symbol=V7", 'symbol=V7 localKey="F minor"')],
    ["explicit nonchord role", named.replace(" chord dd range", " note B@1:2 role=passing\n chord dd range")],
  ])("%s keeps the bass warning", (_, text) => expect(result(text)).toEqual([true, true]));
  it("still reports a soprano augmented fourth inside a proven bass chain", () => {
    const withUpperLeap = named.replace("C5/4. A4/4.", "C5/4. F#5/4.");
    expect(result(withUpperLeap)).toEqual([false, false]);
    // The display groups the raw augmented fourth under the more specific tritone rule.
    expect(result(withUpperLeap, undefined, "soprano", 1440)).toEqual([true, false]);
    expect(checkHarmony(compileScoreText(withUpperLeap).project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "melody.tritone", tick: 1440, voiceIds: ["soprano"], severity: "warning",
    }));
  });
  it("also checks the eventual arrival when the preparation is explicitly named", () => {
    const full = named.replace(" chord dd range", " chord prep range=[1:1,1:2) symbol=IV7\n chord dd range");
    // Roman IV7 compiles to major7. The project can also explicitly encode
    // the major triad with minor seventh that is written in these four parts.
    expect(result(full)).toEqual([true, true]);
    for (const [score, warning] of [[full, false], [full.replace("G3/2.", "G2/2."), true]] as const) {
      const project = compileScoreText(score).project;
      const chord = project.chordTrack.regions[0].identity.structure;
      if (chord.kind !== "tertian") throw new Error("Expected a tertian chord");
      chord.quality = "dominant7";
      expect(result(project)).toEqual([warning, warning]);
    }
  });
  it.each([480, 1440, 2880, 4320])("keeps the warning across phrase boundary %i", cut => {
    expect(result(named, cut)).toEqual([true, true]);
  });
});
