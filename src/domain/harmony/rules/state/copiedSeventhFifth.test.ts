import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument, VoiceId } from "../../../project/types";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

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

const withPart = (bar: Bar, i: number, notes: string): Bar => {
  const result: Bar = [...bar];
  result[i] = notes;
  return result;
};

describe("a newly attacked diatonic seventh-chord fifth in a copied motif", () => {
  it("recognizes the independent four-part model of ex. 26-381 transposed to D", () => {
    const p = score(model, copy);
    expect(warnings(p)).toHaveLength(0);
    p.chordTrack.regions = [];
    expect(warnings(p)).toHaveLength(0);
    const inferred = applyHarmonyInference(p, { chordInference: inferChords(p) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(warnings(inferred)).toHaveLength(0);
  });

  it("reads the printed C-major ex. 26-381 with the seventh in the alto and common tones held", () => {
    const p = inKey("C major",
      ["F4/2", "C4/4 B3/4", "D3/2", "A2/4 G2/4", "SII43/4 D7/4"],
      ["G4/2", "D4/4 C4/4", "E3/2", "B2/4 A2/4", "iii43/4 vi7/4"]);
    expect(warnings(p)).toHaveLength(0);
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

  it("requires the copy of the entire continuation when the two pairs are separated", () => {
    const bridge: Bar = ["F#4/2", "D4/2", "A3/2", "D3/2", "T/2"];
    const next: Bar = ["G4/2", "E4/2", "B3/2", "E3/2", "SII/2"];
    expect(warnings(score(model, bridge, copy, next), 5)).toHaveLength(0);
    expect(warnings(score(model, bridge, copy, withPart(next, 2, "B3/4 B3/4")), 5)).toHaveLength(1);
    expect(warnings(score(model, bridge, copy), 5)).toHaveLength(1);
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

  it("requires the actual seventh in the same voice to descend as written", () => {
    const p = score(model, withPart(copy, 1, "E4/4 F#4/4"));
    expect(warnings(p)).toHaveLength(1);
    expect(warnings(p, 3, "alto", "resolution.chord-seventh")).toHaveLength(1);
  });

  it.each<[string, number, string]>([
    ["model in a different octave", 0, "G5/2"],
    ["interior reattack", 0, "G4/4 G4/4"],
    ["missing source member", 2, "B3/2"],
    ["an enharmonic substitute", 2, "Fb3/2"],
    ["rest in the model", 0, "r/4 G4/4"],
    ["incorrect inversion label", 4, "SII65/4 D7/4"],
  ])("preserves the warning on %s", (_label, v, change) => {
    expect(warnings(score(withPart(model, v, change), copy))).toHaveLength(1);
  });

  it("rejects an isolated pair and a pair at entry even if an exact model follows later", () => {
    expect(warnings(score(copy), 1)).toHaveLength(1);
    expect(warnings(score(copy, model), 1)).toHaveLength(1);
  });

  it("guards a phrase break, a fresh key event, a written ornament and an applied interpretation", () => {
    for (const mutate of [
      (p: ProjectDocument) => p.structure.phraseBoundaries.push({id: "cut", tick: 2*p.ppq, source: "manual", confidence: "certain"}),
      (p: ProjectDocument) => p.keyEvents.push({...p.keyEvents[0], id: "new-key", tick: 2*p.ppq}),
      (p: ProjectDocument) => { p.satbTracks[0].notes[0].nonChordToneRole = "passing"; },
      (p: ProjectDocument) => { p.chordTrack.regions[0].semantics!.interpretations[0].appliedTarget = {degree: 5, primaryFunction: "dominant"}; },
    ]) {
      const p = score(model,copy);
      mutate(p);
      expect(warnings(p)).toHaveLength(1);
    }
  });
});
