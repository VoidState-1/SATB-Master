import { describe, expect, it } from "vitest";
import type { ChordRegion } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";
import { defaultHarmonyRuleSeverities } from "../catalog";

const FIFTH = "resolution.altered-dominant-fifth";
const ALTERED_TONE = "resolution.altered-tone";

const raised = `satb 1
key D major
meter 2/4
bars 1..2 {
 S: | G4/2 | F#4/2 |
 A: | E#4/2 | F#4/2 |
 T: | C#4/2 | A3/2 |
 B: | A2/2 | D3/2 |
}
`;

const lowered = `satb 1
key Bb major
meter 2/4
bars 1..2 {
 S: | Eb5/2 | D5/2 |
 A: | A4/2 | F4/2 |
 T: | Cb4/2 | Bb3/2 |
 B: | F2/2 | Bb2/2 |
}
`;

const wrongRaised = raised.replace("E#4/2 | F#4/2", "E#4/2 | D4/2");
const wrongLowered = lowered.replace("Cb4/2 | Bb3/2", "Cb4/2 | D4/2");

function check(score: string, { cut = false, keyChange = false, tendency, fifthOff = false }: {
  cut?: boolean;
  keyChange?: boolean;
  tendency?: "up" | "down";
  fifthOff?: boolean;
} = {}) {
  const input = compileScoreText(score).project;
  const tick = 2 * input.ppq;
  if (cut) {
    input.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
  }
  if (keyChange) {
    input.keyEvents.push({ ...input.keyEvents[0], id: "new-key", tick, tonic: { step: "A", alter: 0 } });
  }
  const { project } = applyHarmonyInference(input, { chordInference: inferChords(input) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true });
  if (tendency) {
    const makeRegion = (id: string, startTick: number, root: ChordRegion["identity"]["root"],
      quality: "dominant7" | "major"): ChordRegion => ({
      id, startTick, durationTicks: tick, locked: true,
      identity: {
        root, bass: root, structure: {
          kind: "tertian", quality, extensions: [],
          alterations: quality === "dominant7" ? [{ degree: 5, alter: 1, tendency }] : [],
        },
      },
    });
    project.chordTrack.regions = [
      makeRegion("written-dominant", 0, { step: "A", alter: 0 }, "dominant7"),
      makeRegion("written-tonic", tick, { step: "D", alter: 0 }, "major"),
    ];
  }
  const result = checkHarmony(project, {
    ...defaultHarmonyRuleSeverities(),
    ...(fifthOff && { [FIFTH]: "off" }),
  });
  expect(result.skippedRules.filter(skip => skip.ruleId === FIFTH)).toEqual([]);
  return {
    project, tick,
    diagnostics: result.diagnostics.filter(d => d.ruleId === FIFTH || d.ruleId === ALTERED_TONE),
  };
}

describe("E.6 实写属七变五音解决", () => {
  it.each([
    ["女低升五音", wrongRaised, "alto", "F♯", 1],
    ["男高降五音", wrongLowered, "tenor", "B♭", -1],
    ["目标省略五音时的男高降五音", wrongLowered.replace("A4/2 | F4/2", "A4/2 | D4/2"), "tenor", "B♭", -1],
  ] as const)("%s 在盲推后定位到错误落点", (_label, score, voice, destination, direction) => {
    const { project, tick, diagnostics } = check(score);
    const notes = project.satbTracks.find(track => track.voice === voice)!.notes;
    expect(diagnostics).toEqual([expect.objectContaining({
      ruleId: FIFTH, severity: "warning", tick, voiceIds: [voice],
      noteIds: notes.map(note => note.id).sort(),
      params: { destination, direction },
    })]);
  });

  it.each([
    ["升五音、完整主三和弦", raised],
    ["升五音、主和弦省略五音", raised.replace("C#4/2 | A3/2", "C#4/2 | D4/2")],
    ["降五音、完整主三和弦", lowered],
    ["降五音、主和弦省略五音", lowered.replace("A4/2 | F4/2", "A4/2 | D4/2")],
  ])("%s 正确解决", (_label, score) => {
    expect(check(score).diagnostics).toEqual([]);
  });

  it.each([
    ["缺少属七音", wrongRaised.replace("G4/2 | F#4/2", "A4/2 | F#4/2")],
    ["七音落点由另一声部提供", wrongRaised
      .replace("G4/2 | F#4/2", "G4/2 | A4/2").replace("C#4/2 | A3/2", "C#4/2 | F#4/2")],
    ["七音越八度到主三音", wrongRaised.replace("G4/2 | F#4/2", "G4/2 | F#5/2")],
    ["七音延留后才下行", wrongRaised.replace("G4/2 | F#4/2", "G4/2~ | G4/4 F#4/4")],
    ["变五音同声部延留后才离开", wrongRaised.replace("E#4/2 | D4/2", "E#4/2~ | E#4/4 D4/4")],
    ["变五音离开前有休止", wrongRaised.replace("E#4/2 | D4/2", "E#4/4 r/4 | D4/2")],
  ])("%s 时保持静默", (_label, score) => {
    expect(check(score).diagnostics).toEqual([]);
  });

  it.each([
    ["人工乐句边界", { cut: true }],
    ["换调边界", { keyChange: true }],
  ] as const)("不跨%s追踪变五音", (_label, options) => {
    expect(check(wrongRaised, options).diagnostics).toEqual([]);
  });

  it("通过仲裁只显示同一事件的 E.6，关闭 E.6 时仍显示 E.4", () => {
    const generic = check(wrongRaised, { tendency: "up", fifthOff: true }).diagnostics;
    const specific = check(wrongRaised, { tendency: "up" }).diagnostics;
    expect(generic.map(d => d.ruleId)).toEqual([ALTERED_TONE]);
    expect(specific.map(d => d.ruleId)).toEqual([FIFTH]);
    expect(specific[0]).toMatchObject({
      tick: generic[0].tick, voiceIds: generic[0].voiceIds,
      noteIds: generic[0].noteIds, chordIds: generic[0].chordIds,
    });
  });

  it("正确实奏若与显式反向倾向矛盾，E.4 仍指出标注方向", () => {
    const { diagnostics } = check(raised, { tendency: "down" });
    expect(diagnostics.map(d => d.ruleId)).toEqual([ALTERED_TONE]);
    expect(diagnostics[0].params).toMatchObject({ tendency: "down", actualSemitones: 1 });
  });
});
