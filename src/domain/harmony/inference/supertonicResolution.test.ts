import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../index";

const minor = `satb 1
key D minor
meter 4/4
bars 1..1 {
 S: | F5/4 D#5/4 E5/4 F5/4 |
 A: | A4/4 B4/4 B4/4 A4/4 |
 T: | D4/4 F#4/4 E4/4 D4/4 |
 B: | D3/4 A2/4 G2/4 D3/4 |
}`;
const code = "written-supertonic-resolution";
type Setup = (p: ReturnType<typeof compileScoreText>["project"]) => void;

function run(text: string, setup?: Setup, options: Parameters<typeof inferChords>[1] = {}) {
  const { project } = compileScoreText(text);
  setup?.(project);
  const inference = inferChords(project, options);
  const applied = applyHarmonyInference(project, { chordInference: inference },
    { mode: "replace-unlocked", writeNonChordToneRoles: true });
  const at = (beat: number) => applied.project.chordTrack.regions.find(r =>
    r.startTick <= beat * project.ppq && beat * project.ppq < r.startTick + r.durationTicks);
  const proven = inference.regions.filter(r => r.selected?.evidence.some(e => e.code === code));
  return { project, applied, inference, at, proven };
}

describe("complete third-inversion secondary dominant resolving to a chromatic supertonic triad", () => {
  it("writes the two actual identities and no home SII function on the minor goal", () => {
    const { at, applied, project, proven } = run(minor);
    expect(proven).toHaveLength(2);
    expect(at(1)).toMatchObject({ identity: { root: { step: "B", alter: 0 }, bass: { step: "A", alter: 0 },
      structure: { quality: "dominant7" } }, semantics: { interpretations: [{ degree: 6, degreeAlteration: 1 }] } });
    expect(at(1)?.semantics?.interpretations[0].designation).toBeUndefined();
    expect(at(2)?.identity).toMatchObject({ root: { step: "E", alter: 0 }, bass: { step: "G", alter: 0 },
      structure: { quality: "minor" } });
    expect(at(2)?.semantics).toBeUndefined();
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(checkHarmony(applied.project).diagnostics.some(d =>
      d.tick === 2 * project.ppq && d.ruleId === "chord.first-inversion-doubling")).toBe(false);
  });

  it("preserves the major goal's existing double-dominant interpretation", () => {
    const { at, proven } = run(minor.replace("G2/4", "G#2/4"));
    expect(proven).toHaveLength(1);
    expect(at(1)?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(at(2)?.semantics?.interpretations[0]).toMatchObject({ appliedTarget: { degree: 5 } });
    expect(at(2)?.identity).toMatchObject({ root: { step: "E" }, bass: { step: "G", alter: 1 },
      structure: { quality: "major" } });
  });

  it("retains existing absolute fallback behavior outside the proven pair and respects confidence", () => {
    expect(run(minor, undefined, { allowAbsoluteFallback: true }).proven).toHaveLength(2);
    expect(run(minor, undefined, { minConfidence: "high" }).proven).toHaveLength(0);
  });

  it("uses the full score as evidence for a selection inside the arrival", () => {
    const { project } = compileScoreText(minor);
    const range = { fromTick: 2.25 * project.ppq, toTick: 2.75 * project.ppq };
    const { inference } = run(minor, undefined, range);
    expect(inference.regions).toMatchObject([{ ...range, status: "resolved",
      selected: { identity: { root: { step: "E" }, structure: { quality: "minor" } } } }]);
  });

  it.each([
    ["leading tone in the wrong octave", minor.replace("E5/4", "E6/4")],
    ["fifth in the wrong octave", minor.replace("F#4/4 E4/4", "F#4/4 E3/4")],
    ["seventh in the wrong octave", minor.replace("G2/4", "G3/4")],
    ["common tone transferred an octave", minor.replace("B4/4 B4/4", "B4/4 B3/4")],
    ["voices exchange the common tone and tonic", minor.replace("B4/4 B4/4", "B4/4 E4/4")
      .replace("F#4/4 E4/4", "F#4/4 B4/4")],
    ["enharmonic leading tone", minor.replace("D#5/4", "Eb5/4")],
    ["enharmonic third of the goal", minor.replace("G2/4", "F##2/4")],
    ["seventh absent", minor.replace("A2/4", "B2/4")],
    ["diminished goal", minor.replace("B4/4 B4/4", "B4/4 Bb4/4")],
    ["silence between endpoints", minor.replace("D#5/4", "D#5/8 r/8")],
    ["bass is above another voice", minor.replace("A2/4 G2/4", "A4/4 G4/4")],
    ["remote goal", minor.replace("D minor", "G minor")],
    ["major home key", minor.replace("D minor", "D major")],
  ])("does not infer the exceptional connection with %s", (_reason, text) => {
    expect(run(text).proven).toHaveLength(0);
  });

  it("respects manual phrase and printed-key boundaries even with the same notes", () => {
    expect(run(minor, p => p.structure.phraseBoundaries.push({
      id: "break", tick: 2 * p.ppq, source: "manual", confidence: "certain",
    })).proven).toHaveLength(0);
    expect(run(minor, p => p.keyEvents.push({
      ...p.keyEvents[0], id: "new-key", tick: 2 * p.ppq, tonic: { step: "A", alter: 0 },
    })).proven).toHaveLength(0);
  });

  it.each([1, 2])("respects an explicit nonchord role on either end, beat %i", beat => {
    expect(run(minor, p => {
      const note = p.satbTracks[0].notes.find(n => n.startTick === beat * p.ppq)!;
      note.nonChordToneRole = "passing";
    }).proven).toHaveLength(0);
  });

  it("retains the written cross-relation immediately before the pair", () => {
    const { applied, project } = run(minor);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.cross-relation-successive", tick: project.ppq,
      voiceIds: ["bass", "soprano"],
    }));
  });

  it("retains a real unresolved soprano leading tone in the ordinary dominant", () => {
    const bad = minor.replace("D minor", "E minor").replace("D#5/4 E5/4", "D#5/4 B4/4");
    const { applied, project, proven } = run(bad);
    expect(proven).toHaveLength(0);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "resolution.leading-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
    }));
  });

  it("leaves ordinary D2 in its key and still reports an unresolved seventh", () => {
    const bad = minor.replace("D minor", "E minor").replace("G2/4", "E3/4")
      .replace("F#4/4 E4/4", "F#4/4 G4/4");
    const { applied, at, proven } = run(bad);
    expect(proven).toHaveLength(0);
    expect(at(1)?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "resolution.chord-seventh" && d.tick === 1920 &&
      d.voiceIds.includes("bass"))).toBe(true);
  });
});
