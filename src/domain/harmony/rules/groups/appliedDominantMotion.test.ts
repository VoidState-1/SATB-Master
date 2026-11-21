import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { functionalTargetMatches } from "../connector";

type Frame = readonly [string, string, string, string, string];

function exercise(frames: readonly Frame[], key = "C major") {
  const lines = ["S", "A", "T", "B", "H"].map((part, index) =>
    ` ${part}: | ${frames.map(frame => frame[index] + "/4").join(" ")} |`);
  return compileScoreText(`satb 1
key ${key}
meter ${frames.length}/4
bars 1..1 {
${lines.join("\n")}
}`).project;
}

const ruleId = "function.applied-dominant-target";

function check(project: ProjectDocument) {
  const result = checkHarmony(project);
  expect(result.skippedRules.filter(skip => skip.ruleId === ruleId)).toEqual([]);
  const warnings = result.diagnostics.filter(item => item.ruleId === ruleId);
  return { warnings, beats: warnings.map(item => item.tick / project.ppq) };
}

function cutPhrase(project: ProjectDocument, beat: number) {
  project.structure.phraseBoundaries.push({
    id: "split", tick: beat * project.ppq, source: "manual", confidence: "certain",
  });
}

function chordIds(project: ProjectDocument, ...indices: number[]) {
  return indices.map(index => project.chordTrack.regions[index].id).sort();
}

const dd: Frame = ["A4", "D4", "F#3", "D3", "V/V"];
const dd7: Frame = ["A4", "C4", "F#3", "D3", "V7/V"];
const dd43: Frame = ["F#4", "C4", "D3", "A2", "V43/V"];
const dominant: Frame = ["D5", "B4", "G3", "G2", "V"];
const tonic: Frame = ["E4", "G3", "C3", "C2", "I"];
const subdominant: Frame = ["A4", "C4", "F3", "F2", "IV"];

describe("G.2 同目标的属功能延长", () => {
  it.each([{ first: dd }, { first: dd7 }])("三变七或同根换位后，只在最后的错误出口报警", ({ first }) => {
    expect(check(exercise([first, dd43, dominant])).beats).toEqual([]);
    const wrongExit = exercise([first, dd43, subdominant]);
    const { beats, warnings } = check(wrongExit);
    expect(beats).toEqual([2]);
    expect(warnings[0].chordIds).toEqual(chordIds(wrongExit, 1, 2));
    expect(check(exercise([first, subdominant])).beats).toEqual([1]);
  });

  it("同目标标签与实写三音拼写相冲突时保留交界警告", () => {
    const wrongSpelling: Frame = ["Gb4", "C4", "D3", "A2", "V43/V"];
    expect(check(exercise([dd7, wrongSpelling, subdominant])).beats).toEqual([1, 2]);
  });

  it("实写 DD 到 DDVII 可经 K46 解决，DDVII 的错误出口仍须报警", () => {
    const applied: Frame = ["C#5", "G4", "A3", "E3", "DD43"];
    const leading: Frame = ["E5", "G4", "A#3", "C#3", "DDVII7"];
    const sixFour: Frame = ["D5", "G4", "B3", "D3", "K46"];
    const goal: Frame = ["D5", "F#4", "A3", "D3", "V"];
    const wrongExit: Frame = ["E5", "C5", "G3", "C3", "IV"];
    expect(check(exercise([applied, leading, sixFour, goal], "G major")).beats).toEqual([]);
    const rejected = exercise([applied, leading, sixFour, wrongExit], "G major");
    expect(check(rejected)).toMatchObject({ beats: [3], warnings: [{ chordIds: chordIds(rejected, 1, 3) }] });
    expect(check(exercise([applied, leading, wrongExit], "G major")).beats).toEqual([1, 2]);
    const otherVoice: Frame = ["B4", "G4", "D4", "D3", "K46"];
    expect(check(exercise([applied, leading, otherVoice, goal], "G major")).beats).toEqual([1]);
    const conventionalSpelling: Frame = ["E5", "G4", "Bb3", "C#3", "DDVII7"];
    expect(check(exercise([applied, conventionalSpelling, wrongExit], "G major")).beats).toEqual([2]);
  });

  it("一转导减七的升二级实写解决也可经 K46 延续", () => {
    const applied: Frame = ["C#5", "G4", "A3", "E3", "DD43"];
    const leading: Frame = ["A#4", "G4", "C#4", "E3", "DDVII65"];
    const sixFour: Frame = ["B4", "G4", "D4", "D3", "K46"];
    const goal: Frame = ["D5", "F#4", "A3", "D3", "V"];
    expect(check(exercise([applied, leading, sixFour, goal], "G major")).beats).toEqual([]);
    const wrongRole = exercise([applied, leading, sixFour, goal], "G major");
    wrongRole.chordTrack.regions[2].semantics!.cadenceRole = "passing64";
    expect(check(wrongRole).beats).toContain(1);
  });

  it("同响的减七枢纽保留原警告，标签不能替谱面的 D♯/E♭ 决定目标", () => {
    const applied: Frame = ["D#5", "A4", "B3", "F#3", "DD43"];
    const leading: Frame = ["F#5", "A4", "C4", "D#3", "DDVII7"];
    const pivot: Frame = ["F#5", "A4", "C4", "Eb3", "DDVII7"];
    const goal: Frame = ["G#5", "B4", "E4", "E3", "V"];
    const newTonic: Frame = ["G5", "Bb4", "Eb4", "Eb3", "bV"];
    expect(check(exercise([applied, leading, goal], "A minor")).beats).toEqual([]);
    expect(check(exercise([applied, pivot, newTonic], "A minor")).beats).toEqual([1, 2]);
  });

  const german: Frame = ["Eb5", "C5", "F#4", "Ab2", "Ger+6"];
  const french: Frame = ["D5", "C5", "F#4", "Ab2", "Fr+6"];

  it("实写增六变体连续指向属根，增六后的错误出口仍须报警", () => {
    expect(check(exercise([dd7, german, french, dominant])).beats).toEqual([]);
    const rejected = exercise([dd7, german, french, subdominant]);
    expect(check(rejected)).toMatchObject({ beats: [3], warnings: [{ chordIds: chordIds(rejected, 2, 3) }] });
  });

  it("实写 DDVII 也可继续进入同目标增六", () => {
    const leading: Frame = ["Eb5", "C5", "F#4", "A2", "DDVII65"];
    expect(check(exercise([leading, german, dominant])).beats).toEqual([]);
    expect(check(exercise([leading, german, subdominant])).beats).toEqual([2]);
  });

  it.each([
    ["缺少高端", ["D5", "C5", "G4", "Ab2", "Fr+6"]],
    ["低端等音改写", ["D5", "C5", "F#4", "G#2", "Fr+6"]],
    ["两端各自指向别的根音", ["D5", "C5", "G#4", "Ab2", "Fr+6"]],
  ] satisfies [string, Frame][])("同一增六标签但%s时保留交界警告", (_name, wrong) => {
    expect(check(exercise([dd7, wrong, dominant])).beats).toEqual([1]);
  });

  it.each([0.5, 1])("人工句界在第 %s 拍时仍检查原交界", (beat) => {
    const project = exercise([dd7, dd43, dominant]);
    cutPhrase(project, beat);
    expect(check(project).beats).toEqual([1]);
  });
});

const e7: Frame = ["G#4", "D4", "E3", "E2", "V7/VI"];
const a7: Frame = ["G4", "C#4", "E3", "A2", "V7/II"];
const dMinor: Frame = ["F4", "D4", "A3", "D3", "ii"];

describe("G.2 连续属七的目标转移", () => {
  it("以两条实写半音线到达旧根，再独立检查后一个属七的目标", () => {
    const project = exercise([e7, a7, tonic]);
    const { beats, warnings } = check(project);
    expect(beats).toEqual([2]);
    expect(warnings[0].chordIds).toEqual(chordIds(project, 1, 2));
    expect(check(exercise([e7, a7, dMinor])).beats).toEqual([]);
    const analysis = buildHarmonyAnalysis(project);
    const [source, arrival] = analysis.harmonySpans;
    expect(functionalTargetMatches(analysis, source.id, arrival.id,
      source.semantics!.interpretations[0].appliedTarget!)).toBe(false);
    expect(analysis.targetChains.find(chain => chain.sourceSpanId === source.id))
      .toMatchObject({ status: "violated", terminalSpanId: arrival.id });
  });

  it.each([
    ["属七标签与实写小三度相冲突", ["G4", "C4", "E3", "A2", "V7/II"]],
    ["后三音等音错拼", ["G4", "Db4", "E3", "A2", "V7/II"]],
    ["后三音由其他声部接手", ["G4", "E4", "C#4", "A2", "V7/II"]],
    ["后七音在错误八度", ["G5", "C#4", "E3", "A2", "V7/II"]],
    ["低音碰到旧目标但后根不同", ["F#4", "C4", "D3", "A2", "V43/V"]],
  ] satisfies [string, Frame][])("%s时，旧目标和新目标各自报警", (_name, wrong) => {
    expect(check(exercise([e7, wrong, tonic])).beats).toEqual([1, 2]);
  });

  it("属七间标出人工句界或实际休止时仍保留原警告", () => {
    const separated = exercise([e7, a7, tonic]);
    cutPhrase(separated, 1);
    expect(check(separated).beats).toEqual([1, 2]);
    const rest = exercise([e7, a7, tonic]);
    rest.satbTracks[0].notes[0].durationTicks /= 2;
    expect(check(rest).beats).toEqual([1, 2]);
  });

  it("和声覆盖有空隙或局部调已改换时沿用原规则的跳过行为", () => {
    const gap = exercise([e7, a7, tonic]);
    gap.chordTrack.regions[0].durationTicks /= 2;
    expect(check(gap).beats).toEqual([2]);
    const modulated = exercise([e7, a7, tonic]);
    modulated.chordTrack.regions[1].semantics!.interpretations[0].localKey =
      { tonic: { step: "D", alter: 0 }, mode: "minor" };
    expect(check(modulated).beats).toEqual([]);
  });
});
