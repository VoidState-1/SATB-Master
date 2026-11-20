import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../index";

const PPQ = 960;
const landing = 4 * PPQ;

function ending(voices = ["G5/2", "G4/2", "G3/2", "G2/2"], key = "G major",
  dominant = ["F#5", "D5", "A3", "D3"], onsets = "") {
  const initial = ["G5", key.endsWith("minor") ? "Bb4" : "B4", "D4", "G2"];
  return compileScoreText([
    "satb 1", "key " + key, "meter 2/4", onsets, "bars 1..3 {",
    ...["S", "A", "T", "B"].map((voice, i) =>
      voice + ": | " + initial[i] + "/2 | " + dominant[i] + "/2 | " + voices[i] + " |"),
    "}",
  ].join("\n")).project;
}

function analyze(raw: ReturnType<typeof ending>) {
  const chordInference = inferChords(raw);
  const { project } = applyHarmonyInference(raw, { chordInference }, { mode: "replace-unlocked" });
  const analysis = buildHarmonyAnalysis(project);
  return { chordInference, project, analysis, end: analysis.cadenceCandidates.find(candidate =>
    candidate.evidence.some(evidence => evidence.code === "octave-tonic-ending")) };
}

describe("An unharmonized tonic closing after a complete dominant triad", () => {
  it.each(["G major", "G minor"])("reads simultaneous tonic octaves at the real ending in %s", key => {
    const raw = ending(["G5/4 r/4", "G4/4 r/4", "G3/4 r/4", "G3/4 r/4"], key);
    const { end, analysis, project, chordInference } = analyze(raw);
    expect(end).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 2 * PPQ, unharmonizedLandingTick: landing, toTick: 5 * PPQ,
    });
    expect(analysis.slices.find(slice => slice.tick === landing)?.chord).toBeUndefined();
    expect(chordInference.regions.find(region => region.fromTick === landing)?.status).toBe("unclassified");
    expect(project.chordTrack.regions.every(chord => chord.startTick + chord.durationTicks <= landing)).toBe(true);
    expect(checkHarmony(project).diagnostics.map(d => d.ruleId)).not.toContain("cadence.bass-formula");
    expect(checkHarmony(project).diagnostics.map(d => d.ruleId)).not.toContain("cadence.unstable-ending");
    expect(end?.chordIds).toEqual(project.chordTrack.regions.filter(chord => chord.startTick === 2 * PPQ).map(chord => chord.id));
  });

  it.each([
    ["one voice", ["G5/2", "r/2", "r/2", "r/2"]],
    ["only the octave pair", ["G5/2", "r/2", "r/2", "G3/2"]],
    ["all four in exact unison", ["G4/2", "G4/2", "G4/2", "G4/2"]],
    ["four voices in only two registers", ["G5/2", "G5/2", "G3/2", "G3/2"]],
    ["the dominant pedal continues", ["G5/2", "G4/2", "G3/2", "D3/2"]],
    ["a spare fifth", ["G5/2", "G4/2", "D4/2", "G3/2"]],
    ["a brief arrival below one written beat", ["G5/8 r/4.", "G4/8 r/4.", "G3/8 r/4.", "G3/8 r/4."]],
    ["a ragged release", ["G5/2", "G4/4 r/4", "G3/2", "G3/2"]],
    ["a staggered entrance", ["G5/2", "r/8 G4/4.", "G3/2", "G3/2"]],
    ["a G octave in the middle of new motion", ["G5/4 A5/4", "G4/4 F#4/4", "G3/4 D4/4", "G3/4 D3/4"]],
  ])("does not infer this ending with %s", (_description, voices) => {
    expect(analyze(ending(voices)).end).toBeUndefined();
  });

  it("requires a contiguous actual dominant and stepwise leading-tone resolution", () => {
    const closing = ["G5/2", "G4/2", "G3/2", "G3/2"];
    for (const source of [
      ["F#5", "D5", "F#4", "D3"], // written V with the fifth absent
      ["F#5", "C5", "A3", "D3"], // actual V7, seventh needs its own resolution
      ["F#5", "D5", "A3", "A2"], // V in the wrong inversion
      ["D5", "F#4", "A3", "D3"], // soprano jumps; this branch requires an audible lead
      ["F#5", "D5", "A3", "D4"], // bass reaches G3, but crosses the actual tenor
    ]) {
      const negative = analyze(ending(closing, "G major", source));
      expect(negative.end).toBeUndefined();
    }
    const interrupted = ending(closing);
    for (const track of interrupted.satbTracks) {
      const note = track.notes.find(n => n.startTick === 2 * PPQ)!;
      note.durationTicks -= PPQ / 2;
    }
    expect(analyze(interrupted).end).toBeUndefined();
  });

  it("bounds an open excerpt by the sounding quarter without needing a rest or meter change", () => {
    const raw = ending(["G5/4 r/4", "G4/4 r/4", "G3/4 r/4", "G3/4 r/4"]);
    raw.lengthTicks = landing + PPQ;
    expect(raw.meterEvents).toHaveLength(1);
    const { end } = analyze(raw);
    expect(end).toMatchObject({ confidence: "probable", unharmonizedLandingTick: landing, toTick: raw.lengthTicks });
  });

  it("does not recover an arrival across a manual phrase boundary", () => {
    const raw = ending(["G5/2", "G4/2", "G3/2", "G3/2"]);
    raw.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick: landing }];
    expect(analyze(raw).end).toBeUndefined();
  });

  it("needs a major dominant even when the modal seventh has the right bass formula", () => {
    const { end } = analyze(ending(["G5/2", "G4/2", "G3/2", "G3/2"], "G major", ["F5", "C5", "A3", "D3"]));
    expect(end).toBeUndefined();
  });

  it("keeps a new key and a user annotation authoritative", () => {
    const closing = ["G5/2", "G4/2", "G3/2", "G3/2"];
    expect(analyze(ending(closing, "G major", undefined, "at 3:1 key G minor")).end).toBeUndefined();
    expect(analyze(ending(closing, "C major")).end).toBeUndefined();

    const applied = analyze(ending(closing)).project;
    const written = compileScoreText([
      "satb 1", "key G major", "meter 2/4", "bars 1..3 {", "S: empty", "A: empty", "T: empty", "B: empty", "H: | I/2 | V/2 | I/2 |", "}",
    ].join("\n")).project.chordTrack.regions;
    applied.chordTrack.regions = [...applied.chordTrack.regions, ...written.filter(r => r.startTick === landing)];
    const full = buildHarmonyAnalysis(applied).cadenceCandidates.filter(c => c.kind === "full");
    expect(full).toHaveLength(1);
    expect(full[0].unharmonizedLandingTick).toBeUndefined();
  });

  it.each(["Bb4", "B4"])("keeps the explicit minor or raised third %s out of the octave-only branch", third => {
    const { end, project } = analyze(ending(["G5/2", third + "/2", "G3/2", "G3/2"], "G minor"));
    expect(end).toBeUndefined();
    expect(project.satbTracks[1].notes.at(-1)?.pitch.alter).toBe(third === "Bb4" ? -1 : 0);
  });
});
