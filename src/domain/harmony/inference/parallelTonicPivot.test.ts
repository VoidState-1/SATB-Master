import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../index";

const flatRoute = `satb 1
key C major
meter 2/4
bars 1..5 {
 S: | E5/4 D5/4 | C5/4 Bb4/4 | Eb5/4 Db5/4 | C5/4 Bb4/4 | Ab4/2 |
 A: | G4/4 G4/4 | G4/4 G4/4 | Ab4/4 Bb4/4 | Ab4/4 G4/4 | Eb4/2 |
 T: | C4/4 B3/4 | C4/4 Eb4/4 | Eb4/4 Fb4/4 | Eb4/4 Db4/4 | C4/2 |
 B: | C3/4 F3/4 | Eb3/4 Db3/4 | C3/4 Db3/4 | Eb3/4 Eb2/4 | Ab2/2 |
}`;

const sharpRoute = `satb 1
key A minor
meter 2/4
bars 1..5 {
 S: | C5/4 D5/4 | C#5/4 C#5/4 | B4/4 B4/4 | D5/4 A#4/4 | B4/2 |
 A: | E4/4 E4/4 | E4/4 E4/4 | D4/4 E4/4 | F#4/4 E4/4 | D4/2 |
 T: | A3/4 G#3/4 | A3/4 A#3/4 | B3/4 B3/4 | B3/4 C#4/4 | B3/2 |
 B: | A2/4 B2/4 | A2/4 F#2/4 | G2/4 G2/4 | F#2/4 F#2/4 | B2/2 |
}`;

function analyze(text: string, prepare?: (p: ReturnType<typeof compileScoreText>["project"]) => void) {
  const p = compileScoreText(text).project;
  prepare?.(p);
  const result = inferChords(p);
  const written = applyHarmonyInference(p, { chordInference: result },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  const at = (beat: number) => written.chordTrack.regions.find(r =>
    r.startTick <= beat * p.ppq && beat * p.ppq < r.startTick + r.durationTicks);
  const meaning = (beat: number) => at(beat)?.semantics?.interpretations[0];
  return { p, written, meaning, at };
}

describe("parallel tonic as a common chord with a cadentially confirmed destination", () => {
  it.each([
    [flatRoute, "C", "minor", "A", -1, "major"],
    [sharpRoute, "A", "major", "B", 0, "minor"],
  ] as const)("recognizes the changed third in the written tonic and preserves the destination cadence", (score, tonic, mode, step, alter, finalMode) => {
    const { p, written, meaning, at } = analyze(score);
    expect(meaning(0)?.localKey).toBeUndefined();
    expect(meaning(1)?.localKey).toBeUndefined();
    expect(meaning(2)).toMatchObject({ degree: 1, localKey: { tonic: { step: tonic, alter: 0 }, mode } });
    expect(at(2)?.identity.structure).toMatchObject({ kind: "tertian", quality: mode });
    expect(meaning(8)).toMatchObject({ degree: 1, localKey: { tonic: { step, alter }, mode: finalMode } });
    expect(written.keyEvents).toEqual(p.keyEvents);
    expect(buildHarmonyAnalysis(written).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "full", toTick: p.lengthTicks,
    }));
    expect(checkHarmony(written).diagnostics.some(d => d.tick === 2 * p.ppq &&
      d.ruleId === "resolution.leading-tone")).toBe(false);
    const range = { fromTick: 2.5 * p.ppq, toTick: 3 * p.ppq };
    expect(inferChords(p, range).regions).toMatchObject([{ ...range, selected: {
      identity: at(2)?.identity, semantics: { interpretations: [{ localKey: meaning(2)?.localKey }] },
    } }]);
  });

  it("carries a repeated attack of the same written voicing through the pivot", () => {
    const split = flatRoute.replace("C5/4 Bb4/4", "C5/8 C5/8 Bb4/4");
    const { meaning } = analyze(split);
    for (const t of [2, 2.5]) expect(meaning(t)?.localKey).toEqual({ tonic: { step: "C", alter: 0 }, mode: "minor" });
  });

  it.each([
    ["the leading tone resolves in the wrong octave", flatRoute.replace("C4/4 Eb4/4", "C5/4 Eb4/4")],
    ["the seventh resolves in the wrong octave", flatRoute.replace("Eb3/4 Db3/4", "Eb2/4 Db3/4")],
    ["the home dominant is merely a triad", flatRoute.replace("C3/4 F3/4", "C3/4 G3/4")],
    ["only the original minor-mode tonic is present", sharpRoute.replace("C#5/4 C#5/4", "C5/4 C#5/4")],
  ])("keeps the original key with %s despite the same destination", (_why, score) => {
    const { meaning } = analyze(score);
    expect(meaning(2)?.degree).toBe(1);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey).toBeDefined();
  });

  it("keeps an isolated Picardy third and a borrowed minor tonic without a subsequent modulation", () => {
    for (const [score, first, middle, last] of [
      [sharpRoute, "A minor", ["C5 E4 A3 A2", "D5 E4 G#3 B2"], "C#5 E4 A3 A2"],
      [flatRoute, "C major", ["E5 G4 C4 C3", "D5 G4 B3 F3"], "C5 G4 C4 Eb3"],
    ] as const) {
      const text = `satb 1\nkey ${first}\nmeter 2/4\nbars 1..2 {\n` +
        ["S","A","T","B"].map((v,i) => v + ": | " + middle.map(c => c.split(" ")[i] + "/4").join(" ") +
          " | " + last.split(" ")[i] + "/2 |").join("\n") + "\n}";
      expect(analyze(text).meaning(2)?.localKey).toBeUndefined();
      expect(analyze(score).meaning(8)?.localKey).toBeDefined();
    }
  });

  it("requires a sounded tonic establishing the original mode", () => {
    const sameMinorTonic = flatRoute.replace("E5/4 D5/4", "Eb5/4 D5/4");
    const { meaning } = analyze(sameMinorTonic);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey?.tonic).toEqual({ step: "A", alter: -1 });
  });

  it("distinguishes a real modulation whose destination does not contain the proposed common chord", () => {
    const score = `satb 1
key C major
meter 2/4
bars 1..5 {
 S: | E5/4 D5/4 | C5/4 A4/4 | D5/4 C5/4 | B4/4 A4/4 | G4/2 |
 A: | G4/4 G4/4 | G4/4 F#4/4 | G4/4 A4/4 | G4/4 F#4/4 | D4/2 |
 T: | C4/4 B3/4 | C4/4 D4/4 | D4/4 Eb4/4 | D4/4 C4/4 | B3/2 |
 B: | C3/4 F3/4 | Eb3/4 C3/4 | B2/4 C3/4 | D3/4 D2/4 | G2/2 |
}`;
    const { meaning } = analyze(score);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
  });

  it("requires a later cadence in the destination even after its own applied dominant and tonic", () => {
    const score = flatRoute.replace("Eb2/4 | Ab2/2", "Eb2/4 | G2/2");
    expect(analyze(score).meaning(2)?.localKey).toBeUndefined();
  });

  it.each([2, 3, 7])("respects a manual phrase break at beat %i", beat => {
    const { meaning } = analyze(flatRoute, p => {
      p.structure.phraseBoundaries.push({ id: "break", tick: beat * p.ppq, source: "manual", confidence: "certain" });
    });
    expect(meaning(2)?.localKey).toBeUndefined();
  });

  it("respects silence and a printed key change after the pivot", () => {
    expect(analyze(flatRoute.replace("C5/4 Bb4/4", "C5/8 r/8 Bb4/4")).meaning(2)?.localKey).toBeUndefined();
    const { meaning } = analyze(flatRoute, p => {
      p.keyEvents.push({ ...p.keyEvents[0], id: "printed", tick: 3 * p.ppq,
        tonic: { step: "A", alter: -1 }, mode: "major" });
    });
    expect(meaning(2)?.localKey).toBeUndefined();
  });
});
