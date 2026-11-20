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
