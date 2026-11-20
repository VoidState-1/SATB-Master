import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { buildHarmonyAnalysis } from "../../analysis";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { preparesWrittenAppliedSeventh } from "./chromaticAppliedResolution";
import { readRaisedMinorThirdIntoDominant } from "./raisedMinorThirdDominant";
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

  it("七音到达错误八度时保留原低音警告", () => {
    const wrong = raisedInBass.replace("Bb4/2", "Bb5/2");
    expect(warningsAtRaise(wrong)).toContain("bass");
    expect(warningsAtRaise(wrong, "| i65/4. V65/IV/8 | iv/2 |")).toContain("bass");
  });

  it("导音到达错误八度时保留原高音警告", () => {
    const wrong = raisedSeventh.replace("G4/2", "G5/2");
    expect(warningsAtRaise(wrong)).toContain("soprano");
    expect(warningsAtRaise(wrong, "| i42/4. V42/IV/8 | iv6/2 |")).toContain("soprano");
  });

  it("明确的同根主功能标注不能当作局部属", () => {
    expect(warningsAtRaise(raisedTriad, "| i/4. I/8 | iv6/2 |")).toContain("soprano");
  });

  it("明确的目标和弦冲突保留诊断", () => {
    expect(warningsAtRaise(raisedSeventh, "| i42/4. V42/IV/8 | VI/2 |")).toContain("soprano");
  });

  it("保留有独立解决证据的副属七和弦豁免", () => {
    // The original i label covers the late arrival of the minor seventh.
    const score = raisedTriad.replace("A3/2 | G3/2", "A3/4 C4/4 | Bb3/2")
      .replace("D3/2 | Bb2/2", "D3/4 A2/4 | G2/2");
    const project = labelled(score, "| i/4. V43/IV/8 | iv/2 |");
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const motion = context.melodyTransitions({ voiceId: "soprano" })
      .first(item => item.current.startTick === 1.5 * project.ppq)!;
    expect(readRaisedMinorThirdIntoDominant(context, motion)).toBe("unsupported");
    expect(preparesWrittenAppliedSeventh(context, motion)).toBe(true);
    expect(warningsAt(project, 1.5)).toEqual([]);
  });

  it.each([
    ["inferred", false, []],
    ["inferred", true, ["soprano"]],
    ["confirmed", false, ["soprano"]],
  ] as const)("按标注的保留状态核对 %s / locked=%s", (source, locked, expected) => {
    const project = labelled(raisedTriad, "| i/4. I/8 | iv6/2 |");
    const middle = project.chordTrack.regions[1];
    middle.locked = locked;
    middle.semantics!.interpretations[0].source = source;
    expect(warningsAt(project, 1.5)).toEqual(expected);
  });

  it("推导的主读法不覆盖已确认并保留的另一读法", () => {
    const project = labelled(raisedTriad, "| i/4. V/IV/8 | iv6/2 |");
    const other = labelled(raisedTriad, "| i/4. I/8 | iv6/2 |");
    const middle = project.chordTrack.regions[1].semantics!;
    middle.interpretations[0].source = "inferred";
    middle.interpretations = [
      ...middle.interpretations,
      { ...other.chordTrack.regions[1].semantics!.interpretations[0], id: "retained", source: "confirmed" },
    ];
    expect(warningsAt(project, 1.5)).toEqual(["soprano"]);
  });

  it("保护已确认的属七标注，同时允许选定主读法的枢纽和弦", () => {
    const project = labelled(raisedInBass, "| i65/4. V65/IV/8 | iv/2 |");
    const semantics = project.chordTrack.regions[1].semantics!;
    const entry = semantics.interpretations[0];
    const retained = {
      ...entry, id: "retained", source: "confirmed", degree: 1, appliedTarget: undefined,
      designation: { notationSystem: "spasobin", kind: "primary", primaryFunction: "tonic" },
    } as const;
    semantics.interpretations = [entry, retained];

    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const motion = context.melodyTransitions({ voiceId: "bass" })
      .first(item => item.current.startTick === 1.5 * project.ppq)!;
    expect(preparesWrittenAppliedSeventh(context, motion)).toBe(true);
    expect(warningsAt(project, 1.5)).toEqual([]);

    entry.source = "inferred";
    expect(warningsAt(project, 1.5)).toEqual(["bass"]);
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
    expect(warningsAt(project("symbol=bV42/VI"), 1)).toEqual(["soprano"]);
  });
});
