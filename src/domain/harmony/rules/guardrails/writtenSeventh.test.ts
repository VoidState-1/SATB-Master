import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";
import type { ProjectDocument } from "../../../project";
import { transposeSpelledPitch } from "../../../pitch";

function progression(lines: string[], chords?: string, key = "C major") {
  return compileScoreText(["satb 1", "key " + key, "meter 2/4", "bars 1..1 {",
    ...lines.map((line, i) => "SATB"[i] + ": | " + line + " |"),
    ...(chords ? ["H: | " + chords + " |"] : []), "}"].join("\n")).project;
}

function findings(project: ProjectDocument) {
  const check = checkHarmony(project);
  expect(check.skippedRules.filter(skip => skip.reason === "rule-error")).toEqual([]);
  return check.diagnostics.filter(d => d.ruleId === "resolution.chord-seventh");
}

const connections = [
  { name: "V42", source: ["D5", "B4", "G3", "F3"], arrival: ["E5", "C5", "G3", "E3"],
    bad: "C3", part: 3, sourceChord: "V42", goodChord: "I6", badChord: "I" },
  { name: "VII7", source: ["Ab4", "F4", "D4", "B2"], arrival: ["G4", "E4", "G3", "C3"],
    bad: "C5", part: 0, sourceChord: "viio7", goodChord: "I", badChord: "I" },
  { name: "VII65", source: ["Ab4", "F4", "B3", "D3"], arrival: ["G4", "G4", "C4", "E3"],
    bad: "C5", part: 0, sourceChord: "viio65", goodChord: "I6", badChord: "I6" },
  { name: "VIIø7", source: ["A4", "F4", "D4", "B2"], arrival: ["G4", "E4", "G3", "C3"],
    bad: "C5", part: 0, sourceChord: "viiø7", goodChord: "I", badChord: "I" },
  { name: "V7/V → V6", source: ["C5", "A4", "F#3", "D3"], arrival: ["B4", "D4", "G3", "B2"],
    bad: "G4", part: 0, sourceChord: "V7/V", goodChord: "V6", badChord: "V6" },
];

describe.each(connections)("$name 的实写七音", example => {
  it.each(["纯音符", "条件", "盲推", "缺源标签", "缺目标标签"])("%s 的错跳与合法下行", mode => {
    for (const wrong of [true, false]) {
      const { source, arrival, part, bad, sourceChord, goodChord, badChord } = example;
      const lines = source.map((note, i) => note + "/4 " + (wrong && part === i ? bad : arrival[i]) + "/4");
      const target = wrong ? badChord : goodChord;
      const labels = mode === "条件" ? sourceChord + "/4 " + target + "/4" :
        mode === "缺源标签" ? "r/4 " + target + "/4" : mode === "缺目标标签" ? sourceChord + "/4 r/4" : undefined;
      const raw = progression(lines, labels);
      const project = mode === "盲推" ? applyHarmonyInference(raw, { chordInference: inferChords(raw) },
        { mode: "replace-unlocked", writeNonChordToneRoles: true }).project : raw;
      expect(findings(project).map(d => [d.tick, d.voiceIds]), wrong ? "错跳" : "下行").toEqual(
        wrong ? [[project.ppq, [project.satbTracks[part].id]]] : []);
    }
  });

  it("移至降 B 大调后仍区分错跳与下行", () => {
    for (const wrong of [false, true]) {
      const project = progression(example.source.map((note, i) => note + "/4 " +
        (wrong && i === example.part ? example.bad : example.arrival[i]) + "/4"));
      const key = project.keyEvents[0];
      key.tonic = { step: "B", alter: -1 };
      for (const track of project.satbTracks) {
        for (const note of track.notes) note.pitch = transposeSpelledPitch(note.pitch, -2, key);
      }
      expect(findings(project).map(d => d.tick)).toEqual(wrong ? [project.ppq] : []);
    }
  });

  it("旁声部原音重奏不能提前结案或掩盖下一拍的错跳", () => {
    const other = example.part === 0 ? 1 : 0;
    const lines = example.source.map((note, i) => (i === other ? note + "/8 " + note + "/8" : note + "/4") +
      " " + (i === example.part ? example.bad : example.arrival[i]) + "/4");
    const project = progression(lines);
    expect(findings(project)).toMatchObject([{ tick: project.ppq, voiceIds: [project.satbTracks[example.part].id] }]);
  });

  it("人工句界阻断源与落点", () => {
    const lines = example.source.map((note, i) => note + "/4 " + (i === example.part ? example.bad : example.arrival[i]) + "/4");
    for (const labels of [undefined, example.sourceChord + "/4 " + example.badChord + "/4"]) {
      const p = progression(lines, labels);
      p.structure.phraseBoundaries = [{ id: "cut", tick: p.ppq, source: "manual", confidence: "certain" }];
      expect(findings(p)).toEqual([]);
    }
  });
});

describe("七音来源与落点需要各自的证据", () => {
  const v42 = ["D5/4 E5/4", "B4/4 C5/4", "G3/4 G3/4", "F3/4 C3/4"];
  it.each([["B4", 0], ["G4", 1]] as const)("副属七进入第二转位目标时，七音到 %s", (top, count) => {
    const project = progression(["C5/4 " + top + "/4", "A4/4 B3/4", "F#3/4 G3/4", "D3/4 D3/4"]);
    expect(findings(project).map(d => d.tick)).toEqual(count ? [project.ppq] : []);
  });
  it("错跳的低音在主三和弦以外，另三部独立唱全落点", () => {
    const p = progression([...v42.slice(0, 3), "F3/4 F#2/4"]);
    expect(findings(p).map(d => [d.tick, d.voiceIds])).toEqual([[p.ppq, ["bass"]]]);
  });

  it("导七的错跳抽走唯一五音，根三五仍逐一按原声部解决", () => {
    const p = progression(["Ab4/4 C5/4", "F4/4 E4/4", "D4/4 E4/4", "B2/4 C3/4"]);
    expect(findings(p).map(d => [d.tick, d.voiceIds])).toEqual([[p.ppq, ["soprano"]]]);
    p.satbTracks[1].notes[1].pitch.step = "C";
    expect(findings(p)).toEqual([]);
  });
  it.each([
    ["源标签身份冲突", v42, "ii6/4 r/4"],
    ["目标标签身份冲突", v42, "r/4 vi/4"],
    ["源缺三音", [v42[0], "G4/4 C5/4", v42[2], v42[3]]],
    ["落点空五度", ["D5/4 G5/4", ...v42.slice(1)]],
    ["导音没有上行", [v42[0], "B4/4 G4/4", "G3/4 C4/4", v42[3]]],
    ["落点另成完整小七和弦", [...v42.slice(0, 3), "F3/4 A2/4"]],
    ["装饰性的低音邻音偶成 V42", ["D5/4 E5/4", "B4/4 C5/4", "G3/2", "G2/8 F2/8 G2/4"]],
  ] as const)("%s 时保留空白", (_name, lines, chords?: string) => {
    expect(findings(progression([...lines], chords))).toEqual([]);
  });

  it("七音在缺标同和声换位中交接，接手者下行", () => {
    const lines = ["D5/8 F5/8 E5/4", "B4/4 C5/4", "G3/4 G3/4", "F3/8 D3/8 C3/4"];
    for (const labels of [undefined, "V42/8 r/8 I/4", "V42/8 V43/8 I/4"]) {
      expect(findings(progression(lines, labels))).toEqual([]);
    }
  });
});
