import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const raisedTriad = `satb 1
key D minor
meter 2/4
bars 1..2 {
  S: | F4/4. F#4/8 | G4/2 |
  A: | D4/2~ | D4/2 |
  T: | A3/2 | G3/2 |
  B: | D3/2 | Bb2/2 |
}`;

const raisedSeventh = raisedTriad.replace("D3/2 | Bb2/2", "C3/2 | Bb2/2");

const raisedInBass = `satb 1
key D minor
meter 2/4
bars 1..2 {
  S: | C5/2 | Bb4/2 |
  A: | A4/2 | G4/2 |
  T: | D4/2~ | D4/2 |
  B: | F3/4. F#3/8 | G3/2 |
}`;

const rule = "melody.augmented-interval";

function labelled(score: string, harmony: string) {
  return compileScoreText(score.replace(/\}$/, `  H: ${harmony}\n}`)).project;
}

function warningsAtRaise(score: string, harmony?: string) {
  const project = harmony ? labelled(score, harmony) : compileScoreText(score).project;
  const input = harmony ? project : applyHarmonyInference(project, { chordInference: inferChords(project) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
  return warningsAt(input, 1.5);
}

function warningsAt(project: ReturnType<typeof labelled>, quarters: number) {
  const result = checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict" } });
  expect(result.skippedRuleIds).not.toContain(rule);
  return result.diagnostics.filter(diagnostic => diagnostic.ruleId === rule &&
    diagnostic.tick === project.ppq * quarters).flatMap(diagnostic => diagnostic.voiceIds);
}

describe("小三音升为局部属的导音", () => {
  it.each([
    ["N039 的三和弦", raisedTriad, "| i/4. V/IV/8 | iv6/2 |"],
    ["N039 的七和弦", raisedSeventh, "| i42/4. V42/IV/8 | iv6/2 |"],
    ["N071 的低音", raisedInBass, "| i65/4. V65/IV/8 | iv/2 |"],
  ])("%s 在两入口通过", (_name, score, harmony) => {
    expect(warningsAtRaise(score)).toEqual([]);
    expect(warningsAtRaise(score, harmony)).toEqual([]);
  });

  it("七音错八度时低音入音无 B.3，仍查标明的七音义务", () => {
    const wrong = raisedInBass.replace("Bb4/2", "Bb5/2");
    expect(warningsAtRaise(wrong)).toEqual([]);
    const harmony = "| i65/4. V65/IV/8 | iv/2 |";
    expect(warningsAtRaise(wrong, harmony)).toEqual([]);
    const project = labelled(wrong, harmony);
    expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "resolution.chord-seventh", tick: 2 * project.ppq, voiceIds: ["soprano"],
    }));
  });

  it("导音错八度时仍查标明的导音义务", () => {
    const wrong = raisedSeventh.replace("G4/2", "G5/2");
    expect(warningsAtRaise(wrong)).toEqual([]);
    const harmony = "| i42/4. V42/IV/8 | iv6/2 |";
    expect(warningsAtRaise(wrong, harmony)).toEqual([]);
    const project = labelled(wrong, harmony);
    expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "resolution.leading-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
    }));
  });

  it("从标签的局部调取目标拼写并拒绝改根后指向另一调的标签", () => {
    const score = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | Gb4/4 G4/2 | Ab4/2. |
  A: | Eb4/2.~ | Eb4/2. |
  T: | Bb3/2. | Ab3/2. |
  B: | Db3/2. | C3/2. |
}
annotations {
  chord middle range=[1:2,2:1) MIDDLE
  chord target range=[2:1,3:1) symbol=I6 localKey="Ab major"
}`;
    const project = (label: string) => compileScoreText(score.replace("MIDDLE", label)).project;
    expect(warningsAt(project('symbol=V42 localKey="Ab major"'), 1)).toEqual([]);
    expect(warningsAt(project('symbol=V42/VI localKey="C minor"'), 1)).toEqual([]);
    expect(warningsAt(project("symbol=bV42/VI"), 1)).toEqual([]);
  });
});
