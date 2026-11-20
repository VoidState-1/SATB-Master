import { describe, expect, it } from "vitest";
import type { ProjectDocument, VoiceId } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";

const rootPosition = `satb 1
key G major
meter 4/4
bars 1..2 {
 S: | C5/4 SOURCE/4 B4/4 A4/4 | G4/1 |
 A: | G4/2. F#4/4 | G4/1 |
 T: | E4/2 D4/2 | D4/1 |
 B: | C3/4 C#3/4 D3/2 | G2/1 |
}`;

const firstInversion = `satb 1
key Bb major
meter 4/4
bars 1..2 {
 S: | Bb4/2. A4/4 | Bb4/1 |
 A: | Eb4/4 SOURCE/4 D4/4 C4/4 | D4/1 |
 T: | Eb3/4 E3/4 F3/2 | F3/1 |
 B: | G2/2 F2/2 | Bb2/1 |
}`;

const tied = `satb 1
key G major
meter 4/4
bars 1..2 {
 S: | C5/2 SOURCE/4~ SOURCE/4 | B4/4 A4/4 G4/2 |
 A: | G4/1~ | G4/4 F#4/4 G4/2 |
 T: | E4/1 | D4/1 |
 B: | C3/2 C#3/2 | D3/2 G2/2 |
}`;

const ordinary = `satb 1
key G major
meter 4/4
bars 1..1 {
 S: | Bb4/4 B4/4 A4/4 G4/4 |
 A: | G4/2 F#4/4 G4/4 |
 T: | D4/1 |
 B: | G3/2 D3/4 G3/4 |
}`;

const twoChords = `satb 1
key G major
meter 2/4
bars 1..1 {
 S: | Bb4/4 B4/4 |
 A: | G4/2 |
 T: | E4/4 D4/4 |
 B: | C#3/4 D3/4 |
}`;

const spellingRule = "melody.augmented-interval";
const seventhRule = "resolution.chord-seventh";
const rootHarmony = "| IV/4 DDVII7/4 K46/4 V/4 | I/1 |";
const rootCorrection = "B♭4 宜写为 A♯";

function compile(score: string, harmony?: string) {
  const { project } = compileScoreText(harmony ? score.replace(/\}$/, ` H: ${harmony}\n}`) : score);
  return harmony ? project : applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
}

function atLanding(project: ProjectDocument, voice: VoiceId, beat: number) {
  const { diagnostics, skippedRuleIds } = checkHarmony(project);
  expect(skippedRuleIds).not.toContain(spellingRule);
  return diagnostics.filter(d => d.tick === beat * project.ppq && d.voiceIds.includes(voice) &&
    [spellingRule, seventhRule].includes(d.ruleId));
}

function expectSpelling(project: ProjectDocument, voice: VoiceId, from: number, to: number, correction: string) {
  const notes = project.satbTracks.find(track => track.voice === voice)!.notes;
  const noteIds = [from, to].map(beat => notes.find(note => note.startTick === beat * project.ppq)!.id);
  const diagnostics = atLanding(project, voice, to);
  expect(diagnostics).toMatchObject([{
    ruleId: spellingRule, messageKey: `${spellingRule}.structural-spelling`,
    voiceIds: [voice], noteIds: expect.arrayContaining(noteIds),
    message: expect.stringContaining(correction),
  }]);
  expect(diagnostics[0].message.match(/宜写为/g)).toHaveLength(1);
  expect(diagnostics[0].message).toMatch(/K46.*上行|上行.*K46/);
}

describe.each(["推导写回", "给定和弦"])("重属减七向终止四六的拼写（%s）", entry => {
  const projectFor = (score: string, harmony: string) => compile(score, entry === "给定和弦" ? harmony : undefined);

  describe.each([
    { name: "G 大调原位高音", score: rootPosition, harmony: rootHarmony,
      voice: "soprano", from: 1, to: 2, correct: "A#4", wrong: "Bb4", correction: rootCorrection },
    { name: "降 B 大调第一转位中音", score: firstInversion, harmony: "| IV6/4 DDVII65/4 K46/4 V/4 | I/1 |",
      voice: "alto", from: 1, to: 2, correct: "C#4", wrong: "Db4", correction: "D♭4 宜写为 C♯" },
    { name: "前音连音且主音跨落点保持", score: tied, harmony: "| IV/2 DDVII7/2 | K46/4 V/4 I/2 |",
      voice: "soprano", from: 2, to: 4, correct: "A#4", wrong: "Bb4", correction: rootCorrection },
  ] as const)("$name", ({ score, harmony, voice, from, to, correct, wrong, correction }) => {
    it("正确升 II 静默", () => {
      expect(atLanding(projectFor(score.replaceAll("SOURCE", correct), harmony), voice, to)).toEqual([]);
    });

    it("只提示把前音改写为升 II", () => {
      expectSpelling(projectFor(score.replaceAll("SOURCE", wrong), harmony), voice, from, to, correction);
    });
  });

  it("保持两拍的纵向音高，交换中音与次中音落点后仍检查七音", () => {
    const exchanged = rootPosition.replace("SOURCE", "Bb4")
      .replace("G4/2. F#4/4", "G4/2 D4/4 F#4/4")
      .replace("E4/2 D4/2", "E4/2 G4/4 D4/4");
    expect(atLanding(projectFor(exchanged, rootHarmony), "soprano", 2)).toMatchObject([{ ruleId: seventhRule }]);
  });

  it("普通同声部变化半音保持静默", () => {
    expect(atLanding(projectFor(ordinary, "| i/4 I/4 V/4 I/4 |"), "soprano", 1)).toEqual([]);
  });

  it("同主音小调中不套用大调拼写", () => {
    const minor = rootPosition.replace("G major", "G minor").replace("SOURCE", "Bb4");
    expect(atLanding(projectFor(minor, rootHarmony), "soprano", 2).map(d => d.ruleId)).not.toContain(spellingRule);
  });
});

it("两组音盲推写回后，清除落点标签前后均提示前音改写", () => {
  const project = compile(twoChords);
  expectSpelling(project, "soprano", 0, 1, rootCorrection);

  const landingTick = project.ppq;
  project.chordTrack.regions = project.chordTrack.regions
    .filter(region => region.startTick !== landingTick)
    .map(region => region.startTick < landingTick
      ? { ...region, durationTicks: Math.min(region.durationTicks, landingTick - region.startTick) }
      : region);
  expect(project.chordTrack.regions.some(region => region.startTick <= landingTick &&
    landingTick < region.startTick + region.durationTicks)).toBe(false);
  expectSpelling(project, "soprano", 0, 1, rootCorrection);
});

it("同一未锁定的推导标签覆盖两组音时，默认同和弦豁免仍保留落点提示", () => {
  const project = compile(twoChords);
  const source = project.chordTrack.regions.find(region => region.startTick === 0)!;
  expect(project.chordTrack.locked).toBe(false);
  expect(source).toMatchObject({
    locked: false,
    identity: { root: { step: "C", alter: 1 }, structure: { quality: "diminished7" } },
  });
  project.chordTrack.regions = [{ ...source, durationTicks: project.lengthTicks }];
  expectSpelling(project, "soprano", 0, 1, rootCorrection);
});
