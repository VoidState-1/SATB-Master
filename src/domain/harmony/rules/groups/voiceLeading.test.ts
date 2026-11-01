import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  PPQ,
  type NoteEvent,
  type VoiceId,
} from "../../../project";
import { spellMidi } from "../../../pitch";
import { checkHarmony } from "../../registry";

function pairProject(
  upper: readonly [number, number],
  lower: readonly [number, number],
  voiceIds: readonly [VoiceId, VoiceId] = ["soprano", "bass"],
  startTick = 0,
) {
  const project = createEmptyProject();
  project.lengthTicks = startTick + PPQ * 2;
  [upper, lower].forEach((pitches, voiceIndex) => {
    const voiceId = voiceIds[voiceIndex];
    project.satbTracks.find((track) => track.id === voiceId)!.notes =
      pitches.map((midi, index): NoteEvent => ({
        id: `${voiceId}-${index}`,
        startTick: startTick + index * PPQ,
        durationTicks: PPQ,
        pitch: spellMidi(midi),
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      }));
  });
  return project;
}

const rules = [
  {
    label: "五度",
    ruleId: "voice-leading.parallel-fifths",
    contraryUpper: [67, 72],
    contraryLower: [60, 53],
    parallelUpper: [67, 69],
    parallelLower: [60, 62],
    heldUpper: [67, 67],
    heldLower: [60, 48],
  },
  {
    label: "八度",
    ruleId: "voice-leading.parallel-octaves",
    contraryUpper: [65, 70],
    contraryLower: [53, 46],
    parallelUpper: [72, 74],
    parallelLower: [60, 62],
    heldUpper: [72, 72],
    heldLower: [60, 48],
  },
] as const;

describe.each(rules)("连续纯$label", (rule) => {
  it.each([
    ["soprano", "bass"],
    ["alto", "tenor"],
  ] as const)("识别 %s 与 %s 反向扩张到复音程", (upperId, lowerId) => {
    const project = pairProject(
      rule.contraryUpper,
      rule.contraryLower,
      [upperId, lowerId],
    );
    const diagnostics = checkHarmony(project).diagnostics.filter(
      (item) => item.ruleId === rule.ruleId,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ tick: PPQ, severity: "error" });
    expect(diagnostics[0].voiceIds).toEqual(
      expect.arrayContaining([upperId, lowerId]),
    );
    expect(diagnostics[0].noteIds).toHaveLength(4);
  });

  it("识别反向收缩的连续音程", () => {
    const project = pairProject(
      [rule.contraryUpper[1], rule.contraryUpper[0]],
      [rule.contraryLower[1], rule.contraryLower[0]],
    );
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .toContain(rule.ruleId);
  });

  it("保留同向进行的检测", () => {
    const project = pairProject(rule.parallelUpper, rule.parallelLower);
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .toContain(rule.ruleId);
  });

  it.each(["upper", "lower"] as const)(
    "%s 声部重复同音时不误报斜向进行",
    (stationaryVoice) => {
      const upper: readonly [number, number] = stationaryVoice === "upper"
        ? rule.heldUpper : [rule.heldUpper[0], rule.heldUpper[0] + 12];
      const lower: readonly [number, number] = stationaryVoice === "upper"
        ? rule.heldLower : [rule.heldLower[0], rule.heldLower[0]];
      const project = pairProject(upper, lower);
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .not.toContain(rule.ruleId);
    },
  );

  it("持续音遇到另一声部换音时不误报", () => {
    const project = pairProject(rule.heldUpper, rule.heldLower);
    const track = project.satbTracks.find((item) => item.id === "soprano")!;
    track.notes = [{ ...track.notes[0], durationTicks: PPQ * 2 }];
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .not.toContain(rule.ruleId);
  });

  it("两个声部都重复同音时不误报", () => {
    const project = pairProject(
      [rule.parallelUpper[0], rule.parallelUpper[0]],
      [rule.parallelLower[0], rule.parallelLower[0]],
    );
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .not.toContain(rule.ruleId);
  });

  it("休止隔开的两个音程不视为连续进行", () => {
    const project = pairProject(rule.contraryUpper, rule.contraryLower);
    project.satbTracks.forEach((track) => {
      if (track.notes[0]) track.notes[0].durationTicks = PPQ / 2;
    });
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .not.toContain(rule.ruleId);
  });

  it("反向进入非纯音程时不误报", () => {
    const project = pairProject(
      [rule.contraryUpper[0], rule.contraryUpper[1] + 1],
      rule.contraryLower,
    );
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .not.toContain(rule.ruleId);
  });
});

it("复现第 4 小节末 F4/F3 反向进入第 5 小节 B♭4/B♭2", () => {
  const project = pairProject([65, 70], [53, 46], ["soprano", "bass"], PPQ * 15);
  for (const track of project.satbTracks) {
    if (track.notes[1]) {
      track.notes[1].pitch = {
        step: "B",
        alter: -1,
        octave: track.id === "soprano" ? 4 : 2,
      };
    }
  }
  const diagnostics = checkHarmony(project).diagnostics.filter(
    (item) => item.ruleId === "voice-leading.parallel-octaves",
  );
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ tick: PPQ * 16 });
});

it("识别同度反向展开到八度", () => {
  const project = pairProject([60, 67], [60, 55]);
  expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
    .toContain("voice-leading.parallel-octaves");
});

it("五度反向进入八度时不作为连续五度或连续八度", () => {
  const project = pairProject([67, 69], [60, 57]);
  const ids = checkHarmony(project).diagnostics.map((item) => item.ruleId);
  expect(ids).not.toContain("voice-leading.parallel-fifths");
  expect(ids).not.toContain("voice-leading.parallel-octaves");
});
