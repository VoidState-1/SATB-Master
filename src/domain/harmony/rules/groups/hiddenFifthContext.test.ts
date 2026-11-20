import { expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const rule = "voice-leading.hidden-fifth";
function fifths(project: ProjectDocument, strict = false) {
  return checkHarmony(project, undefined, {}, strict ? { [rule]: { "same-harmony": "strict" } } : {})
    .diagnostics.filter(d => d.ruleId === rule);
}

it("同向进入纯十二度时按起跳和落点核实和声", () => {
  const { project } = compileScoreText(`satb 1
key C major
meter 6/8
bars 1..1 {
 S: | D5/4. G5/4. |
 A: | A4/4. E5/8 C5/4 |
 T: | D4/4. G4/4. |
 B: | D3/4 F3/8 C4/4. |
 H: | ii/4 ii6/8 I/4. |
}`);
  expect(fifths(project)).toContainEqual(expect.objectContaining({
    tick: 1.5 * PPQ, endTick: 2 * PPQ, severity: "warning", voiceIds: ["bass", "soprano"],
  }));
});

function revoicing() {
  return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | E4/4 G5/2 |
 A: | C4/4 E5/4 E5/4 |
 T: | G3/4 G4/2 |
 B: | E3/4 C4/2 |
 H: | I6/4 I/2 |
}`).project;
}

it.each([true, false])("在实奏的同和弦转位上保留例外，有标注 %s", labeled => {
  const project = revoicing();
  if (!labeled) project.chordTrack.regions = [];
  expect(fifths(project, true)).toContainEqual(expect.objectContaining({ tick: PPQ }));
  expect(fifths(project)).toEqual([]);
});

it("相同的实奏音集合在明确换调后仍报隐伏五度", () => {
  const project = revoicing();
  const interpretation = project.chordTrack.regions[1].semantics!.interpretations[0];
  interpretation.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
  interpretation.degree = 5;
  expect(fifths(project)).toContainEqual(expect.objectContaining({ tick: PPQ, severity: "warning" }));
});
