import { describe, expect, it } from "vitest";
import { validateProject } from "../../../../project";
import type { ProjectDocument, VoiceId } from "../../../../project/types";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../../index";
import { checkHarmony } from "../../../registry";

type Bar = [string, string, string, string, string];
const model: Bar = ["G4/2", "D4/4 C#4/4", "E3/2", "B2/4 A2/4", "SII43/4 D7/4"];
const copy: Bar = ["A4/2", "E4/4 D4/4", "F#3/2", "C#3/4 B2/4", "iii43/4 vi7/4"];

function inKey(key: string, ...bars: Bar[]) {
  const lines = [..."SATBH"].map((part, i) => part + ": | " + bars.map(b => b[i]).join(" | ") + " |");
  return compileScoreText(["satb 1", "key " + key, "meter 2/4", "bars 1.." + bars.length + " {", ...lines, "}"].join("\n")).project;
}

function score(...bars: Bar[]) {
  return inKey("D major", ...bars);
}

function warnings(p: ProjectDocument, beat = 3, voice: VoiceId = "bass", rule = "resolution.leading-tone") {
  return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === beat * p.ppq &&
    d.severity === "warning" && d.voiceIds.includes(voice));
}

describe("the fifth of a diatonic mediant seventh chord", () => {
  it("stays free of E.1 in ex. 26-381 transposed to D with given, absent or inferred chords", () => {
    const p = score(model, copy);
    expect(warnings(p)).toHaveLength(0);
    p.chordTrack.regions = [];
    expect(warnings(p)).toHaveLength(0);
    const inferred = applyHarmonyInference(p, { chordInference: inferChords(p) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(warnings(inferred)).toHaveLength(0);
  });

  it("does not require an earlier matching statement of the C-major motif", () => {
    const incompleteModel: Bar = ["r/4 F4/4", "C4/4 B3/4", "D3/2", "A2/4 G2/4", "SII43/4 D7/4"];
    const mediant: Bar = ["G4/2", "D4/4 C4/4", "E3/2", "B2/4 A2/4", "iii43/4 vi7/4"];
    expect(warnings(inKey("C major", mediant), 1)).toHaveLength(0);
    expect(warnings(inKey("C major", incompleteModel, mediant))).toHaveLength(0);
  });

  it("two fully copied pairs cannot excuse an actual dominant third and rising seventh", () => {
    const p = score(
      ["F#4/4 G4/4", "D4/4 E4/4", "G3/4 C#4/4", "B2/4 A2/4", "r/4 D7/4"],
      ["G4/4 A4/4", "E4/4 F#4/4", "A3/4 D4/4", "C#3/4 B2/4", "D65/4 vi7/4"]);
    expect(warnings(p)).toHaveLength(1);
    expect(warnings(p, 3, "soprano", "resolution.chord-seventh")).toHaveLength(1);
    p.chordTrack.regions = [];
    expect(warnings(p)).toHaveLength(1);
  });

  it("does not reinterpret a genuine dominant third when reattacked or tied into its new chord", () => {
    const bridge: Bar = ["A4/2", "E4/2", "A3/2", "C#3/2", "D6/2"];
    const next: Bar = ["B4/2", "F#4/2", "B3/2", "D3/2", "vi6/2"];
    const p = score(model, bridge, copy, next);
    const bass = p.satbTracks.find(track => track.voice === "bass")!;
    const previous = bass.notes.find(n => n.startTick === 2 * p.ppq)!;
    expect(warnings(p, 5)[0]?.noteIds).toContain(previous.id);
    previous.durationTicks += p.ppq;
    bass.notes = bass.notes.filter(n => n.startTick !== 4 * p.ppq);
    expect(warnings(p, 5)[0]?.noteIds).toContain(previous.id);
  });

  it("preserves the actual leading tone and seventh in the next cadence", () => {
    const bad: Bar = ["C#5/4 F#5/4", "G4/4 A4/4", "E4/4 D4/4", "A2/4 D3/4", "D7/4 T/4"];
    const p = score(model, copy, bad);
    expect(warnings(p)).toHaveLength(0);
    expect(warnings(p, 5, "soprano")).toHaveLength(1);
    expect(warnings(p, 5, "alto", "resolution.chord-seventh")).toHaveLength(1);
  });

  it("checks the alto's actual seventh independently of the bass fifth", () => {
    const risingSeventh: Bar = [...copy];
    risingSeventh[1] = "E4/4 F#4/4";
    const resolved = score(model, copy);
    const unresolved = score(model, risingSeventh);
    expect(warnings(resolved, 3, "alto", "resolution.chord-seventh")).toHaveLength(0);
    expect(warnings(unresolved, 3, "alto", "resolution.chord-seventh")).toHaveLength(1);
    expect(warnings(unresolved)).toHaveLength(0);
  });
});

const relativeMinor = ["G#4 A4", "E4 E4", "B3 A3", "D3 C3"];

function dominantSeventhFifthScore(lines = relativeMinor, key = "C major") {
  const count = lines[0].split(" ").length;
  const parts = lines.map((line, i) =>
    "SATB"[i] + ": | " + line.split(" ").map(n => n + "/4").join(" ") + " |");
  return compileScoreText(["satb 1", "key " + key, "meter " + count + "/4", "bars 1..1 {", ...parts, "}"].join("\n")).project;
}

function dominantSeventhFifthWarnings(p: ProjectDocument, voice: VoiceId = "tenor", beat = 1, rule = "resolution.leading-tone") {
  return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === beat * p.ppq &&
    d.severity === "warning" && d.voiceIds.includes(voice));
}

function annotated() {
  const p = dominantSeventhFifthScore();
  const shape = (step: "E" | "A", bass: "D" | "C", quality: "dominant7" | "minor") => ({
    root: { step, alter: 0 as const }, bass: { step: bass, alter: 0 as const },
    structure: { kind: "tertian" as const, quality, extensions: [], alterations: [] },
  });
  p.chordTrack.regions = [
    { id: "source", locked: false, startTick: 0, durationTicks: p.ppq, identity: shape("E", "D", "dominant7") },
    { id: "arrival", locked: false, startTick: p.ppq, durationTicks: p.ppq, identity: shape("A", "C", "minor") },
  ];
  return p;
}

const literal = { primaryInterpretationId: "reading", interpretations: [{
  id: "reading", degree: 3 as const, degreeAlteration: 0 as const, source: "manual" as const, confidence: "certain" as const,
}] };

describe("the ambient leading pitch as the fifth of a local dominant", () => {
  it.each([
    ["D2 to a minor sixth chord", relativeMinor, "tenor"],
    ["D43 to a major triad", ["G#4 A4", "E4 E4", "D4 C#4", "B2 A2"], "bass"],
    ["D65 with the fifth in the soprano", ["B4 A4", "D4 C#4", "E3 E3", "G#2 A2"], "soprano"],
  ] as const)("%s", (_name, voices, voice) => {
    expect(dominantSeventhFifthWarnings(dominantSeventhFifthScore([...voices]), voice)).toHaveLength(0);
  });

  it("reads a flat minor key with an altered home leading note and a different local tonic", () => {
    expect(dominantSeventhFifthWarnings(dominantSeventhFifthScore(["B4 C5", "G4 G4", "D4 C4", "F3 Eb3"], "Eb minor"))).toHaveLength(0);
  });

  it("accepts a sounding identity alone and the literal root degree in the home key", () => {
    const p = annotated();
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(0);
    p.chordTrack.regions[0].semantics = literal;
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(0);
  });

  it("leaves the fifth free of E.1 even without a seventh or an independent local tonic proof", () => {
    expect(dominantSeventhFifthWarnings(dominantSeventhFifthScore(["G#4 A4", "E4 E4", "B3 A3", "E3 C3"]))).toHaveLength(0);
    expect(dominantSeventhFifthWarnings(dominantSeventhFifthScore(["G#4 A4", "E4 E4", "B3 G##3", "D3 C3"]))).toHaveLength(0);
  });

  it.each([
    ["its octave is wrong", ["G#4 A5", "E4 E4", "B3 A3", "D3 C3"]],
    ["another part supplies the tonic", ["G#4 E5", "E4 A4", "B3 A3", "D3 C3"]],
  ])("reports the real local leading part if %s", (_name, lines) => {
    const p = dominantSeventhFifthScore(lines);
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(0);
    expect(dominantSeventhFifthWarnings(p, "soprano")).toMatchObject([{ params: { key: "A minor", leadingTone: "G♯" } }]);
  });

  it("reads the tonic when another member changes register", () => {
    const p = dominantSeventhFifthScore(["G#5 A5", "E4 E5", "B3 A3", "D3 C3"]);
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(0);
    expect(dominantSeventhFifthWarnings(p, "soprano")).toHaveLength(0);
  });

  it("keeps the sustained B's E.1 from the preceding home dominant", () => {
    const p = dominantSeventhFifthScore(["D5 G#4 A4", "G4 E4 E4", "B3 B3 A3", "G3 D3 C3"]);
    const tenor = p.satbTracks.find(t => t.voice === "tenor")!;
    tenor.notes[0].durationTicks += p.ppq;
    tenor.notes.splice(1, 1);
    expect(dominantSeventhFifthWarnings(p, "tenor", 2)).toMatchObject([{
      params: { key: "C major", leadingTone: "B" },
      noteIds: expect.arrayContaining([tenor.notes[0].id]),
      trace: expect.arrayContaining([{ tick: 0, outcome: "continue", reason: "obligation-opened" }]),
    }]);
  });

  it.each([
    ["descends by an octave plus a step", { step: "C", alter: 0, octave: 2 }],
    ["ascends a step", { step: "E", alter: 0, octave: 3 }],
  ] as const)("reports E.2 when the seventh %s while leaving the fifth free of E.1", (_motion, pitch) => {
    const p = annotated();
    expect(dominantSeventhFifthWarnings(p, "bass", 1, "resolution.chord-seventh")).toHaveLength(0);
    p.satbTracks.find(t => t.voice === "bass")!.notes[1].pitch = pitch;
    expect(dominantSeventhFifthWarnings(p, "bass", 1, "resolution.chord-seventh")).toHaveLength(1);
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(0);
  });

  it("keeps a genuine minor-key leading tone descending on a deceptive resolution", () => {
    const p = dominantSeventhFifthScore(["B4 A4", "E4 C4", "G#3 F3", "E2 F2"], "A minor");
    expect(dominantSeventhFifthWarnings(p)).toHaveLength(1);
  });
});

const passage = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | B4/4 D5/4 C5/4 |
  A: | F4/4 G4/4 G4/4 |
  T: | D4/4 F4/4 E4/4 |
  B: | G2/4 B2/4 C3/4 |
  H: | D7/4 D65/4 T/4 |
}`;

function handoff() {
  const { project } = compileScoreText(passage);
  for (const chord of project.chordTrack.regions.slice(0, 2)) {
    chord.semantics!.interpretations[0].localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
  }
  return project;
}

function resolutionWarnings(project: ReturnType<typeof handoff>) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics
    .filter(item => item.tick === project.ppq && (item.ruleId === "resolution.leading-tone" || item.ruleId === "resolution.chord-seventh"))
    .map(item => [item.ruleId, ...item.voiceIds]);
}

describe("转位时导音和七音在声部间交接", () => {
  it("同一局部调性用不同 JSON 字段顺序写入，两个声部照常交接", () => {
    const project = handoff();
    expect(resolutionWarnings(project)).toEqual([]);
    project.chordTrack.regions[1].semantics!.interpretations[0].localKey =
      { mode: "major", tonic: { alter: 0, step: "C" } };
    expect(resolutionWarnings(project)).toEqual([]);
  });

  it("实际改变局部调式时保留两个原声部的解决警告", () => {
    const project = handoff();
    project.chordTrack.regions[1].semantics!.interpretations[0].localKey!.mode = "minor";
    expect(resolutionWarnings(project)).toEqual(expect.arrayContaining([
      ["resolution.leading-tone", "soprano"],
      ["resolution.chord-seventh", "alto"],
    ]));
  });

  it("接手低音未奏出导音时，仍在原女高声部报警", () => {
    const project = handoff();
    project.satbTracks.find(track => track.id === "bass")!.notes[1].pitch = { step: "D", alter: 0, octave: 3 };
    expect(resolutionWarnings(project)).toEqual([["resolution.leading-tone", "soprano"]]);
  });
});
