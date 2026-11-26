import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { primaryHarmonyInterpretation } from "../../../chordModel";
import { applyHarmonyInference, inferChords, inferHarmony } from "..";
import { buildChordInferenceObservations } from "../observations";

function project(lines: readonly string[], key = "C major") {
  const bars = lines[0].split("|").length;
  const voices = lines.map((line, i) => `${"SATB"[i]}: | ${line} |`).join("\n");
  return compileScoreText(`satb 1\nkey ${key}\nmeter 4/4\nbars 1..${bars} {\n${voices}\n}`).project;
}

function at(p: ReturnType<typeof project>, beat: number) {
  const tick = beat * p.ppq;
  return inferChords(p).regions.find(r => r.fromTick <= tick && tick < r.toTick)!;
}

function keyAt(p: ReturnType<typeof project>, beat: number) {
  const semantics = at(p, beat).selected?.semantics;
  return semantics && primaryHarmonyInterpretation(semantics).localKey;
}

describe("written ornamental paths", () => {
  const chain = ["G5/4 Ab5/16 A5/16 Bb5/16 B5/16 C6/2", "E4/1", "C4/2 G3/2", "C3/1"];

  it("retains one tonic through four passing attacks, including the literal vi6 slice", () => {
    const p = project(chain);
    const result = inferHarmony(p);
    expect(result.chordInference.regions).toHaveLength(1);
    expect(result.chordInference.regions[0]).toMatchObject({ status: "resolved", selected: { functionalBaseId: "T" } });
    const written = applyHarmonyInference(p, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(written.project.satbTracks[0].notes.map(n => n.nonChordToneRole))
      .toEqual([undefined, "passing", "passing", "passing", "passing", undefined]);
  });

  it.each(["reversal", "bass attack", "phrase cut", "role conflict"] as const)("breaks the long-line proof on %s", issue => {
    const lines = [...chain];
    if (issue === "reversal") lines[0] = lines[0].replace("Bb5/16", "Ab5/16");
    if (issue === "bass attack") lines[3] = "C3/4. C3/8 C3/2";
    const p = project(lines);
    if (issue === "phrase cut") p.structure.phraseBoundaries.push({ id: "cut", tick: 1.5 * p.ppq, source: "manual", confidence: "certain" });
    if (issue === "role conflict") p.satbTracks[0].notes[2].nonChordToneRole = "anticipation";
    expect(inferChords(p).regions.some(r => r.selected?.evidence.some(e => e.code === "written-passing-line-over-held-harmony"))).toBe(false);
  });

  it("uses the structural bass while two neighbours sound, and preserves an independent inversion on the same bass", () => {
    const lower = ["D4/1", "B3/1", "G2/4. F2/8 G2/2"];
    const decorated = project(["F5/4. E5/8 F5/2", ...lower]);
    const bass = decorated.satbTracks[3].notes[1];
    expect(at(decorated, 1.5)).toMatchObject({ status: "resolved", selected: { functionalBaseId: "D",
      identity: { bass: { step: "G" } }, fit: { nonChordToneAssignments: { [bass.id]: "neighbor" } } } });
    const literal = project(["F5/4. F5/8 F5/2", ...lower]);
    expect(at(literal, 1.5).selected).toMatchObject({ identity: { bass: { step: "F" } }, fit: { nonChordToneAssignments: {} } });
  });
});

describe("written spelling and functional context", () => {
  it("keeps D sharp and E flat as distinct observed names even when doubled at the octave", () => {
    const good = project(["D#5/1", "D#4/1", "F#3/1", "B2/1"], "B major");
    const mixed = project(["D#5/1", "Eb4/1", "F#3/1", "B2/1"], "B major");
    expect(at(good, 0).selected?.functionalBaseId).toBe("T");
    expect(buildChordInferenceObservations(mixed)[0].soundingPitchClasses).toHaveLength(4);
    expect(at(mixed, 0).selected?.functionalBaseId).not.toBe("T");
  });

  it("distinguishes the diminished seventh of harmonic major from its enharmonic rotation", () => {
    expect(at(project(["Ab4/1", "F4/1", "D4/1", "B2/1"]), 0).selected).toMatchObject({
      functionalBaseId: "DVII", identity: { root: { step: "B" }, structure: { quality: "diminished7" } },
    });
    expect(at(project(["G#4/1", "F4/1", "D4/1", "B2/1"]), 0).selected?.functionalBaseId).not.toBe("DVII");
  });

  it("requires the missing-fifth dominant's written third to reach its tonicized degree", () => {
    const lower = ["A4/4 A4/2.", "A3/4 F3/2.", "A2/4 D3/2."];
    const resolved = at(project(["C#5/4 D5/2.", ...lower]), 0);
    expect(resolved.selected).toMatchObject({ fit: { omittedChordDegrees: [5] },
      semantics: { interpretations: [{ appliedTarget: { degree: 2 } }] } });
    const wrong = at(project(["Db5/4 D5/2.", ...lower]), 0);
    expect(wrong.selected?.evidence.some(e => e.code === "resolved-dominant-without-fifth")).not.toBe(true);
  });

  it("follows a spelled diminished seventh through V7/vi while keeping the written key", () => {
    const lines = ["F5/4 E5/4 E5/4 E5/4", "D5/4 D5/4 C5/4 C5/4", "B3/4 B3/4 C4/4 G3/4", "G#2/4 G#2/4 A2/4 C3/4"];
    const first = at(project(lines), 0).selected;
    expect(first?.evidence.some(e => e.code === "applied-leading-seventh-through-dominant")).toBe(true);
    expect(first?.semantics?.interpretations[0]).toMatchObject({ degree: 7, appliedTarget: { degree: 6 } });
    expect(first?.semantics?.interpretations[0].localKey).toBeUndefined();
    const respelled = at(project([...lines.slice(0, 3), "Ab2/4 G#2/4 A2/4 C3/4"]), 0).selected;
    expect(respelled?.evidence.some(e => e.code === "applied-leading-seventh-through-dominant")).not.toBe(true);
  });

  it("reads lowered VI through parallel-minor harmony and withholds it before unrelated material", () => {
    const borrowed = project(["Ab5/4 G5/4 F5/2", "C5/4 Bb4/4 C5/2", "Eb4/4 Eb4/4 Ab4/2", "Ab2/4 G2/4 F2/2"]);
    expect(at(borrowed, 0).selected?.semantics?.interpretations[0]).toMatchObject({ degree: 6, degreeAlteration: -1 });
    const isolated = project(["Ab5/4 G5/2.", "C5/4 E5/2.", "Eb4/4 C4/2.", "Ab2/4 C3/2."]);
    expect(at(isolated, 0).selected?.functionalBaseId).not.toBe("TSVI");
  });

  it("confirms an equal-accent cadential six-four only with both written resolutions", () => {
    const bass = "G2/1 | G2/1 | C3/1";
    const complete = project(["C5/1 | B4/1 | C5/1", "E4/1 | D4/1 | E4/1", "G3/1 | G3/1 | G3/1", bass]);
    const exchanged = project(["C5/1 | D5/1 | C5/1", "E4/1 | G4/1 | E4/1", "G3/1 | B3/1 | G3/1", bass]);
    const proof = (p: typeof complete) => at(p, 0).selected?.evidence.some(e => e.code === "cadential64-resolution");
    expect(proof(complete)).toBe(true);
    expect(proof(exchanged)).toBe(false);
  });
});

describe("consolidation of a destination key", () => {
  it("distinguishes a sustained iiø7–V7–i from a brief applied V7/ii", () => {
    const stable = project(["D5/4 C#5/4 D5/2", "Bb4/4 G4/4 F4/2", "G3/4 E4/4 A3/2", "E3/4 A2/4 D3/2"]);
    const brief = project(["D5/4 C#5/4 D5/4 E5/4", "Bb4/4 G4/4 F4/4 G4/4", "G3/4 E4/4 A3/4 C4/4", "E3/4 A2/4 D3/4 C3/4"]);
    expect(keyAt(stable, 1)).toEqual({ tonic: { step: "D", alter: 0 }, mode: "minor" });
    expect(keyAt(brief, 1)).toBeUndefined();
    expect(at(brief, 1).selected?.semantics?.interpretations[0].appliedTarget?.degree).toBe(2);
  });

  it("requires a second upper-voice dominant resolution over the destination pedal", () => {
    const lower = ["C4/4 B3/4 D4/4 B3/4", "A3/4 D3/4 A3/4 D3/4", "D3/4 G2/2."];
    expect(keyAt(project(["F#4/4 G4/4 F#4/4 G4/4", ...lower]), 0)).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
    expect(keyAt(project(["F#4/4 G4/4 F4/4 G4/4", ...lower]), 0)).toBeUndefined();
  });
});
