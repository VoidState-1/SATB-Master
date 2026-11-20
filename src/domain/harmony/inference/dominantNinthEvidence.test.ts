import { describe, expect, it } from "vitest";
import { chordIdentityToneSpellingForDegree } from "../../chordModel";
import { formatPitchClass } from "../../pitch";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";
import type { ChordInferenceApplyOptions, ChordInferenceCandidate, ChordInferenceOptions } from "./types";

function analyze(text: string, options: ChordInferenceOptions = { minConfidence: "high" }) {
  const { project } = compileScoreText(text);
  const result = inferHarmony(project, options);
  return {
    project,
    regions: result.chordInference.regions,
    apply: (settings: Omit<ChordInferenceApplyOptions, "mode"> = {}) =>
      applyHarmonyInference(project, result, { mode: "replace-unlocked", ...settings }).project,
  };
}

function ninth(candidate: ChordInferenceCandidate | undefined) {
  const pitch = candidate && chordIdentityToneSpellingForDegree(candidate.identity, 9);
  return pitch && formatPitchClass(pitch);
}

function sameRootReadings(region: ReturnType<typeof analyze>["regions"][number]) {
  const readings = [region.selected, ...region.alternatives];
  return {
    extended: readings.find(reading => ninth(reading)),
    prepared: readings.find(reading => reading?.evidence.some(item => item.code === "prepared-suspension")),
  };
}

const isolated = (mode: string, pitch: string) => `satb 1
key C ${mode}
meter 2/4
bars 1..1 {
 S: | ${pitch}/2 |
 A: | F4/2 |
 T: | B3/2 |
 B: | G2/2 |
}`;

// Preparation from ex. 23–319, paired with the same-root exit in 23–329.
const tied = `satb 1
key C minor
meter 2/4
bars 1..2 {
 S: | Ab4/2~ | Ab4/4 G4/4 |
 A: | F4/2~ | F4/2 |
 T: | C4/2 | B3/2 |
 B: | F2/2 | G2/2 |
}`;

const weakOnset = `satb 1
key C minor
meter 2/4
bars 1..2 {
 S: | Ab4/2 | G4/2 |
 A: | F4/2~ | F4/2 |
 T: | C4/4 B3/4~ | B3/2 |
 B: | F2/4 G2/4~ | G2/2 |
}`;

describe("Written identity and motion of a dominant ninth", () => {
  it.each([
    ["major", "A4", "A"],
    ["minor", "A4", "A"],
  ])("keeps the exact %s spelling %s at high confidence", (mode, pitch, expected) => {
    const analysis = analyze(isolated(mode, pitch));
    const [region] = analysis.regions;
    expect(region).toMatchObject({ status: "resolved", selected: { confidence: "high" } });
    expect(ninth(region.selected)).toBe(expected);
    expect(analysis.apply().chordTrack.regions[0]?.identity).toEqual(region.selected!.identity);
  });

  it.each(["major", "minor"])("offers the isolated small ninth in %s for review at its written pitch", mode => {
    expect(analyze(isolated(mode, "Ab4")).regions[0].selected).toBeUndefined();
    const analysis = analyze(isolated(mode, "Ab4"), {});
    const [region] = analysis.regions;
    expect(region).toMatchObject({ status: "ambiguous", selected: { confidence: "low", fit: { spellingConsistent: true } } });
    expect(ninth(region.selected)).toBe("A♭");
    expect(analysis.apply().chordTrack.regions).toHaveLength(0);
    const applied = analysis.apply({ candidateChoices: new Map([[region.id, region.selected!.id]]) });
    expect(applied.chordTrack.regions[0]?.identity).toEqual(region.selected?.identity);
  });

  it.each([["major", "Bbb4"], ["minor", "G#4"]])("keeps %s enharmonic spelling for review", (mode, pitch) => {
    expect(analyze(isolated(mode, pitch)).regions[0].selected).toBeUndefined();
    const analysis = analyze(isolated(mode, pitch), {});
    expect(analysis.regions[0]).toMatchObject({ status: "ambiguous", selected: { confidence: "low" } });
    expect(analysis.apply().chordTrack.regions).toHaveLength(0);
  });

  it("returns two applicable readings for an accented and actually held 9–8", () => {
    const analysis = analyze(tied);
    const start = 2 * analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === start)!;
    const { extended, prepared } = sameRootReadings(region);
    expect(region).toMatchObject({ status: "resolved", selected: { id: extended?.id } });
    expect(extended?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dominant-ninth-preparation", details: { atTick: start } }),
      expect.objectContaining({ code: "dominant-ninth-same-root-9-8", details: { atTick: start + analysis.project.ppq } }),
    ]));
    expect(prepared?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "prepared-suspension", details: { figure: "9-8", fromTick: start, toTick: start + analysis.project.ppq } }),
    ]));
    for (const candidate of [extended!, prepared!]) {
      const applied = analysis.apply({ candidateChoices: new Map([[region.id, candidate.id]]), writeNonChordToneRoles: true });
      expect(applied.chordTrack.regions.find(item => item.startTick === start)?.identity).toEqual(candidate.identity);
      expect(applied.satbTracks).toEqual(analysis.project.satbTracks);
      expect(checkHarmony(applied).diagnostics.some(item =>
        item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === start)).toBe(false);
    }
    const invalid = analysis.apply({ candidateChoices: new Map([[region.id, "not-a-candidate"]]) });
    expect(invalid.chordTrack.regions.find(item => item.startTick === start)).toBeUndefined();
    const literal = analyze(tied, { minConfidence: "high", allowNonChordToneCandidates: false });
    expect(sameRootReadings(literal.regions.find(item => item.fromTick === start)!).prepared).toBeUndefined();
  });

  it.each(["2:1", "2:2"])("retains both 9–8 readings across a restated key at %s", beat => {
    const input = tied.replace("meter 2/4", "meter 2/4\nat " + beat + " key C minor");
    const analysis = analyze(input);
    const start = 2 * analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === start)!;
    const { prepared, extended } = sameRootReadings(region);
    expect(ninth(extended)).toBe("A♭");
    expect(prepared).toBeDefined();
    const applied = analysis.apply({ candidateChoices: new Map([[region.id, prepared!.id]]) });
    expect(checkHarmony(applied).diagnostics.some(d =>
      d.ruleId === "chord.unclassified-nonchord-tone" && d.tick === start)).toBe(false);
  });

  it("does not infer a 9–8 suspension over a real change of mode", () => {
    const input = tied.replace("meter 2/4", "meter 2/4\nat 2:2 key C major");
    const analysis = analyze(input);
    const region = analysis.regions.find(item => item.fromTick === 2 * analysis.project.ppq)!;
    expect(sameRootReadings(region).prepared).toBeUndefined();
  });

  it("retains D.1 for the same written V7 when the supposed preparation is reattacked", () => {
    const score = tied.replace("Ab4/2~", "Ab4/2").replace("\n}", "\n H: | s/2 | D7/2 |\n}");
    const { project } = compileScoreText(score);
    expect(checkHarmony(project).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleId: "chord.unclassified-nonchord-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
    })]));
  });

  it.each([
    ["同音重奏", tied.replace("Ab4/2~", "Ab4/2"), 2, true],
    ["弱位经过强位落根", weakOnset, 1, true],
    ["另一个上声部也换八度", tied.replace("B3/2", "B3/4 B2/4"), 2, false],
  ])("区分%s的证据", (_label, text, beat, expectedExit) => {
    const analysis = analyze(text);
    const start = beat * analysis.project.ppq;
    const { extended, prepared } = sameRootReadings(analysis.regions.find(item => item.fromTick === start)!);
    expect(ninth(extended)).toBe("A♭");
    expect(prepared).toBeUndefined();
    expect(extended?.evidence.some(item => item.code === "dominant-ninth-same-root-9-8") ?? false).toBe(expectedExit);
  });

  it.each([
    ["minor", "F5/2", "Ab4/4 G4/4", "B3/2", "G3/2"],
    ["major", "Ab5/4 G5/4", "B4/2", "F4/2", "G3/2"],
  ])("keeps ex. 23–329 in %s as a ninth with a known exit and no proved preparation", (mode, s, a, t, b) => {
    const analysis = analyze(`satb 1
key C ${mode}
meter 2/4
bars 1..1 {
 S: | ${s} |
 A: | ${a} |
 T: | ${t} |
 B: | ${b} |
}`);
    const { extended, prepared } = sameRootReadings(analysis.regions[0]);
    expect(ninth(extended)).toBe("A♭");
    expect(extended?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dominant-ninth-same-root-9-8" })]));
    expect(prepared).toBeUndefined();
    expect(analysis.apply().chordTrack.regions[0]?.identity).toEqual(extended?.identity);
  });

  it("records a direct tonic resolution separately from same-root motion", () => {
    const analysis = analyze(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | Ab4/4 G4/4 |
 A: | B3/4 C4/4 |
 T: | F3/4 Eb3/4 |
 B: | G2/4 C3/4 |
}`);
    const { extended, prepared } = sameRootReadings(analysis.regions[0]);
    expect(ninth(extended)).toBe("A♭");
    expect(extended?.evidence.filter(item => item.kind === "sequence-context").map(item => item.code))
      .toEqual(["dominant-ninth-to-tonic"]);
    expect(prepared).toBeUndefined();
  });

  it("does not write the fleeting vertical small ninth in the A-major pedal counterexample", () => {
    // Huang, vol. 2, p. 419, written exercise 1 (1), isolated pedal figure.
    const analysis = analyze(`satb 1
key A major
meter 3/4
bars 1..1 {
 S: | C#5/4 D5/8 C#5/8 B4/4 |
 A: | G#4/2 G#4/4 |
 T: | E4/4 F4/8 E4/8 D4/4 |
 B: | E3/2. |
}`, {});
    const at = analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === at)!;
    expect(region).toMatchObject({ status: "ambiguous", selected: { confidence: "low" } });
    expect(ninth(region.selected)).toBe("F");
    expect(analysis.apply().chordTrack.regions.some(item => item.startTick === at)).toBe(false);
  });
});
