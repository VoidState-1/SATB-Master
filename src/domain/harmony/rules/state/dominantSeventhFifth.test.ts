import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument, VoiceId } from "../../../project/types";
import { checkHarmony } from "../../index";

const relativeMinor = ["G#4 A4", "E4 E4", "B3 A3", "D3 C3"];

function score(lines = relativeMinor, key = "C major") {
  const count = lines[0].split(" ").length;
  const parts = lines.map((line, i) =>
    "SATB"[i] + ": | " + line.split(" ").map(n => n + "/4").join(" ") + " |");
  return compileScoreText(["satb 1", "key " + key, "meter " + count + "/4", "bars 1..1 {", ...parts, "}"].join("\n")).project;
}

function warnings(p: ProjectDocument, voice: VoiceId = "tenor", beat = 1, rule = "resolution.leading-tone") {
  return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === beat * p.ppq &&
    d.severity === "warning" && d.voiceIds.includes(voice));
}

function annotated() {
  const p = score();
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
    expect(warnings(score([...voices]), voice)).toHaveLength(0);
  });

  it("reads a flat minor key with an altered home leading note and a different local tonic", () => {
    expect(warnings(score(["B4 C5", "G4 G4", "D4 C4", "F3 Eb3"], "Eb minor"))).toHaveLength(0);
  });

  it("accepts a sounding identity alone and the literal root degree in the home key", () => {
    const p = annotated();
    expect(warnings(p)).toHaveLength(0);
    p.chordTrack.regions[0].semantics = literal;
    expect(warnings(p)).toHaveLength(0);
  });

  it("leaves the fifth free of E.1 even without a seventh or an independent local tonic proof", () => {
    expect(warnings(score(["G#4 A4", "E4 E4", "B3 A3", "E3 C3"]))).toHaveLength(0);
    expect(warnings(score(["G#4 A4", "E4 E4", "B3 G##3", "D3 C3"]))).toHaveLength(0);
  });

  it.each([
    ["its octave is wrong", ["G#4 A5", "E4 E4", "B3 A3", "D3 C3"]],
    ["another part supplies the tonic", ["G#4 E5", "E4 A4", "B3 A3", "D3 C3"]],
  ])("reports the real local leading part if %s", (_name, lines) => {
    const p = score(lines);
    expect(warnings(p)).toHaveLength(0);
    expect(warnings(p, "soprano")).toMatchObject([{ params: { key: "A minor", leadingTone: "G♯" } }]);
  });

  it("reads the tonic when another member changes register", () => {
    const p = score(["G#5 A5", "E4 E5", "B3 A3", "D3 C3"]);
    expect(warnings(p)).toHaveLength(0);
    expect(warnings(p, "soprano")).toHaveLength(0);
  });

  it("keeps the sustained B's E.1 from the preceding home dominant", () => {
    const p = score(["D5 G#4 A4", "G4 E4 E4", "B3 B3 A3", "G3 D3 C3"]);
    const tenor = p.satbTracks.find(t => t.voice === "tenor")!;
    tenor.notes[0].durationTicks += p.ppq;
    tenor.notes.splice(1, 1);
    expect(warnings(p, "tenor", 2)).toMatchObject([{
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
    expect(warnings(p, "bass", 1, "resolution.chord-seventh")).toHaveLength(0);
    p.satbTracks.find(t => t.voice === "bass")!.notes[1].pitch = pitch;
    expect(warnings(p, "bass", 1, "resolution.chord-seventh")).toHaveLength(1);
    expect(warnings(p)).toHaveLength(0);
  });

  it("keeps a genuine minor-key leading tone descending on a deceptive resolution", () => {
    const p = score(["B4 A4", "E4 C4", "G#3 F3", "E2 F2"], "A minor");
    expect(warnings(p)).toHaveLength(1);
  });
});
