import { describe, expect, it } from "vitest";
import { resolveBuiltinRuleProfile, setBuiltinRuleException } from "../../../ruleProfile";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";
import type { RuleExceptionPolicy } from "../types";

const rule = "melody.tritone";
const target = 960;

function makeScore(lines: readonly string[], harmony = "", key = "F major", meter = "2/4") {
  return compileScoreText([
    "satb 1", "key " + key, "meter " + meter, "bars 1..1 {",
    ...["S", "A", "T", "B"].map((voice, i) => " " + voice + ": | " + lines[i] + " |"),
    ...(harmony ? [" H: | " + harmony + " |"] : []), "}",
  ].join("\n")).project;
}

function infer(project: ReturnType<typeof makeScore>) {
  return applyHarmonyInference(project, { chordInference: inferChords(project) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
}

function tritones(project: ReturnType<typeof makeScore>) {
  const profile = resolveBuiltinRuleProfile(project);
  return checkHarmony(project, profile.severities, profile.configs, profile.exceptions)
    .diagnostics.filter(item => item.ruleId === rule);
}

const handoff = ["Bb4/4 G4/4", "E4/4 Bb3/4", "G3/4 E3/4", "C3/4 C3/4"];
const correct = ["Bb4/4 G4/4", "C4/4 Bb3/4", "E3/4 E3/4", "C3/4 C3/4"];

describe("属七换位时实写增四度接手七音", () => {
  it.each(["C3/4 C3/4", "C3/2"])("整体移调，低音 %s 仍保留同一个属七与女低音诊断", bass => {
    const project = infer(makeScore([...handoff.slice(0, 3), bass]));
    expect(project.chordTrack.regions).toEqual([expect.objectContaining({
      startTick: 0, durationTicks: 2 * target,
      identity: expect.objectContaining({ structure: expect.objectContaining({ quality: "dominant7" }) }),
    })]);
    expect(tritones(project)).toEqual([expect.objectContaining({
      tick: target, voiceIds: ["alto"], severity: "warning",
      noteIds: ["note-A-0", "note-A-960"],
      evidence: expect.arrayContaining([expect.objectContaining({ kind: "note", id: "note-S-0", label: "原声部的七音" })]),
    })]);
  });

  it.each(["D7/2", "D7/4 D7/4"])("显式标注 %s 时默认仍报告", harmony => {
    expect(tritones(makeScore(handoff, harmony))).toEqual([expect.objectContaining({
      tick: target, voiceIds: ["alto"], severity: "warning",
    })]);
  });

  it.each([
    [{ "same-harmony": "exempt" }, undefined],
    [{ "same-harmony": "downgrade" }, "suggestion"],
    [{ "same-harmony": "strict" }, "warning"],
    [{ arpeggiation: "exempt" }, undefined],
  ] as const)("保留已有显式策略 %j", (policy: RuleExceptionPolicy, severity) => {
    const score = makeScore(handoff);
    score.ruleProfile.builtin[rule].exceptions = policy;
    const project = infer(score);
    expect(project.ruleProfile.builtin[rule].exceptions).toEqual(policy);
    expect(tritones(project).map(d => d.severity)).toEqual(severity ? [severity] : []);
  });

  it("旧工程显式豁免可在恢复规则默认并重开后重新检查", () => {
    const project = infer(makeScore(handoff));
    setBuiltinRuleException(project, rule, { "same-harmony": "exempt" });
    const reopened = JSON.parse(JSON.stringify(project)) as typeof project;
    expect(tritones(reopened)).toEqual([]);
    setBuiltinRuleException(reopened, rule, undefined);
    expect(tritones(JSON.parse(JSON.stringify(reopened)))).toMatchObject([
      { tick: target, voiceIds: ["alto"], severity: "warning" },
    ]);
  });

  it("原书根音级进接手七音的修正保持静默", () => {
    expect(tritones(infer(makeScore(correct)))).toEqual([]);
  });

  it("七音在原声部持续时保持静默", () => {
    const p = infer(makeScore(["F4/2", "D4/2", "B3/4 G3/4", "G2/4 B2/4"], "", "C major"));
    expect(p.satbTracks.find(t => t.id === "soprano")!.notes).toEqual([
      expect.objectContaining({ startTick: 0, durationTicks: 2 * target }),
    ]);
    expect(tritones(p)).toEqual([]);
  });

  it("准备后持续并级进解决的真正 4–3 延留保持静默", () => {
    const lines = ["C5/2 B4/4", "E4/4 F4/2", "G3/4 D4/2", "C3/4 G2/2"];
    const blind = infer(makeScore(lines, "", "C major", "3/4"));
    const conditioned = makeScore(lines, "I/4 V7/2", "C major", "3/4");
    for (const project of [blind, conditioned]) {
      expect(project.satbTracks.find(t => t.id === "soprano")!.notes).toEqual([
        expect.objectContaining({ startTick: 0, durationTicks: 2 * target }),
        expect.objectContaining({ startTick: 2 * target, pitch: { step: "B", alter: 0, octave: 4 } }),
      ]);
      expect(tritones(project)).toEqual([]);
    }
  });

  it("保留旧七音的配置不能证明接手，默认同和声处理继续生效", () => {
    const p = makeScore(["Bb4/2", "E4/4 Bb3/4", "G3/4 E3/4", "C3/2"], "D7/2");
    expect(tritones(p)).toEqual([]);
    p.ruleProfile.builtin[rule].exceptions = { "same-harmony": "strict" };
    expect(tritones(p)).toEqual([expect.objectContaining({ tick: target, voiceIds: ["alto"] })]);
  });
});
