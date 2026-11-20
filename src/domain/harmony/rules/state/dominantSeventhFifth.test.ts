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

describe("four written parts resolve an inverted dominant seventh", () => {
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

  it("rejects a fresh key event at the landing even when the written key is repeated", () => {
    const p = score();
    p.keyEvents.push({ ...p.keyEvents[0], id: "new-key", tick: p.ppq });
    expect(warnings(p)).toHaveLength(1);
  });

  it("accepts a sounding identity alone and the literal root degree in the home key", () => {
    const p = annotated();
    expect(warnings(p)).toHaveLength(0);
    p.chordTrack.regions[0].semantics = literal;
    expect(warnings(p)).toHaveLength(0);
  });

  it("accepts a held common tone and repeated literal labels within the same sounding chord", () => {
    const p = annotated();
    const part = p.satbTracks.find(t => t.voice === "alto")!;
    part.notes[0].durationTicks += part.notes[1].durationTicks;
    part.notes.splice(1);
    const source = p.chordTrack.regions[0];
    source.durationTicks = p.ppq / 2;
    p.chordTrack.regions.splice(1, 0, { ...source, id: "split", startTick: p.ppq / 2, semantics: literal });
    expect(warnings(p)).toHaveLength(0);
  });

  it.each<[string, string[]]>([
    ["missing seventh", ["G#4 A4", "E4 E4", "B3 A3", "E3 C3"]],
    ["seventh in the wrong octave", ["G#4 A4", "E4 E4", "B3 A3", "D3 C2"]],
    ["leading pitch rises an octave too far", ["G#4 A5", "E4 E4", "B3 A3", "D3 C3"]],
    ["different voices deliver the third and root", ["G#4 E5", "E4 A4", "B3 A3", "D3 C3"]],
    ["enharmonic source", ["Ab4 A4", "E4 E4", "B3 A3", "D3 C3"]],
    ["enharmonic landing", ["G#4 A4", "E4 E4", "B3 G##3", "D3 C3"]],
    ["root changes register", ["G#5 A5", "E4 E5", "B3 A3", "D3 C3"]],
    ["root position to a six-four", ["G#4 A4", "D4 C4", "B3 A3", "E2 E2"]],
    ["rest in another part", ["r A4", "E4 E4", "B3 A3", "D3 C3"]],
  ])("%s retains the written-key warning", (_name, lines) => {
    expect(warnings(score(lines))).toHaveLength(1);
  });

  it("keeps the same-note obligation opened over a previous harmony", () => {
    const p = score(["D5 G#4 A4", "G4 E4 E4", "B3 B3 A3", "G3 D3 C3"]);
    const tenor = p.satbTracks.find(t => t.voice === "tenor")!;
    tenor.notes[0].durationTicks += p.ppq;
    tenor.notes.splice(1, 1);
    expect(warnings(p, "tenor", 2)).toHaveLength(1);
  });

  it("retains both actual seventh and fifth warnings when the written seventh goes up", () => {
    const p = annotated();
    p.satbTracks.find(t => t.voice === "bass")!.notes[1].pitch.step = "E";
    expect(warnings(p)).toHaveLength(1);
    expect(warnings(p, "bass", 1, "resolution.chord-seventh")).toHaveLength(1);
  });

  it("preserves a manual boundary, an ornamental note and conflicting endpoint identity", () => {
    const boundary = annotated();
    boundary.structure.phraseBoundaries.push({ id: "boundary", source: "manual", confidence: "certain", tick: boundary.ppq });
    expect(warnings(boundary)).toHaveLength(1);
    const ornament = annotated();
    ornament.satbTracks.find(t => t.voice === "alto")!.notes[1].nonChordToneRole = "passing";
    expect(warnings(ornament)).toHaveLength(1);
    const conflict = annotated();
    conflict.chordTrack.regions[1].identity.bass.step = "A";
    expect(warnings(conflict)).toHaveLength(1);
  });

  it("retains explicit functional and contradictory literal readings at the opening", () => {
    for (const reading of [
      { ...literal.interpretations[0], degree: 4 as const },
      { ...literal.interpretations[0], localKey: { tonic: { step: "C" as const, alter: 0 as const }, mode: "major" as const } },
      { ...literal.interpretations[0], designation: { notationSystem: "spasobin" as const, kind: "side-degree" as const } },
    ]) {
      const p = annotated();
      p.chordTrack.regions[0].semantics = { ...literal, interpretations: [reading] };
      expect(warnings(p)).toHaveLength(1);
    }
  });

  it("keeps a genuine minor-key leading tone descending on a deceptive resolution", () => {
    const p = score(["B4 A4", "E4 C4", "G#3 F3", "E2 F2"], "A minor");
    expect(warnings(p)).toHaveLength(1);
  });
});
