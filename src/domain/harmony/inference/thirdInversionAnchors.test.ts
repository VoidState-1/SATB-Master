import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, checkHarmony, inferHarmony } from "../index";

const home = "Ab4 F4 C4 F3";
const d2 = "C#5 A4 E4 G3";
const six = "D5 A4 D4 F#3";
const passing = "E5 A4 C#4 E3";
const root = "F#5 A4 D4 D3";
const fourThree = "G5 C#5 A4 E3";
const close = "F#5 D5 A4 D3";
const iiSix = "B4 G4 E4 G3";
const route = [home, d2, six, passing, root, home, home, home];
const repeated = [home, d2, six, fourThree, close, iiSix, d2, six, home, home, home, home];

function score(chords: string[], key = "F minor") {
  const tracks = ["S", "A", "T", "B"].map((voice, part) => {
    const notes = chords.map(c => c.split(" ")[part] + "/4");
    const bars = Array.from({ length: chords.length / 4 }, (_, i) => notes.slice(i * 4, i * 4 + 4).join(" "));
    return voice + ": | " + bars.join(" | ") + " |";
  });
  return compileScoreText(`satb 1\nkey ${key}\nmeter 4/4\nbars 1..${chords.length / 4} {\n${tracks.join("\n")}\n}`).project;
}

type Project = ReturnType<typeof score>;
function analyze(chords: string[], options: Parameters<typeof inferHarmony>[1] = {}, setup?: (p: Project) => void, key?: string) {
  const p = score(chords, key);
  setup?.(p);
  const { chordInference: r } = inferHarmony(p, options);
  const applied = applyHarmonyInference(p, { chordInference: r }, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const at = (beat: number) => applied.project.chordTrack.regions.find(c =>
    c.startTick <= beat * p.ppq && beat * p.ppq < c.startTick + c.durationTicks);
  const region = (beat: number) => r.regions.find(c => c.fromTick <= beat * p.ppq && beat * p.ppq < c.toTick);
  const proof = (beat: number) => region(beat)?.selected?.evidence.find(e => e.code === "written-third-inversion-return")?.details;
  return { p, r, applied, at, region, proof };
}

function change(chords: string[], beat: number, voicing: string) {
  return chords.map((c, i) => i === beat ? voicing : c);
}

describe("written third-inversion resolutions supported by another dominant inversion", () => {
  it.each([
    [route, "major", 1], [route.map(c => c.replaceAll("F#","F")), "minor", 0],
  ] as const)("recovers an independent passing return in either mode", (music, mode, alter) => {
    const { p, applied, at, proof } = analyze([...music]);
    expect(proof(1)).toMatchObject({ role: "D2", anchor: "passing-six-four", rootTonicTick: 4 * p.ppq, mode });
    expect(at(1)?.identity).toMatchObject({ root: { step: "A", alter: 0 }, bass: { step: "G", alter: 0 },
      structure: { quality: "dominant7" } });
    expect(at(2)?.identity).toMatchObject({ root: { step: "D", alter: 0 }, bass: { step: "F", alter },
      structure: { quality: mode } });
    expect(at(1)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(2)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(2)?.semantics?.interpretations[0].designation).toBeUndefined();
    expect(proof(3)).toBeUndefined();
    expect(applied.project.keyEvents).toEqual(p.keyEvents);
    expect(applied.project.satbTracks).toEqual(p.satbTracks);
  });

  it("uses a metrical root arrival and a following ii6 as independent witnesses on either side", () => {
    const { p, at, proof, applied } = analyze(repeated);
    for (const [beat, role] of [[1,"D2"],[2,"T6"],[3,"D43"],[4,"T"],[6,"D2"],[7,"T6"]] as const)
      expect(proof(beat)).toMatchObject({ role, rootTonicTick: 4 * p.ppq, tonicStep: "D", mode: "major" });
    expect(proof(1)?.anchor).toBe("root-position-close");
    expect(proof(6)?.anchor).toBe("preceding-close-and-ii6");
    expect(at(4)?.identity.bass).toEqual({ step: "D", alter: 0 });
    expect(applied.project.chordTrack.regions.every(c => !c.semantics?.interpretations[0].localKey)).toBe(true);
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "tonality.unmarked-key-change")).toBe(false);
  });

  it("does not promote a lone remote V2–I6 or its verbatim repeat", () => {
    const { at, proof } = analyze([home,d2,six,home,home,d2,six,home]);
    expect(at(1)).toBeUndefined();
    expect(proof(2)).toBeUndefined();
    expect(at(5)).toBeUndefined();
  });

  it("preserves explicit selection of low-confidence absolute fallbacks", () => {
    const { p, r, at, region } = analyze([home,d2,six,home,home,d2,six,home], { allowAbsoluteFallback: true });
    const suggestion = region(1)!;
    expect(suggestion.status).toBe("ambiguous");
    expect(at(1)).toBeUndefined();
    const manual = applyHarmonyInference(p, { chordInference: r }, { mode: "fill-gaps", selection: new Set([suggestion.id]) });
    expect(manual.project.chordTrack.regions.map(c => c.identity)).toEqual([suggestion.selected!.identity]);
  });

  it.each([
    ["wrong initial octave", change(route, 2, "D6 A4 D4 F#3")],
    ["enharmonic initial third", change(route, 1, "Db5 A4 E4 G3")],
    ["exchanged anchor voices", change(route, 3, "C#5 A4 E4 E3")],
    ["anchor bass octave leap", change(route, 4, "F#5 A4 D4 D2")],
    ["missing final third", change(route, 4, "D5 A4 D4 D3")],
    ["rest on corroboration", change(route, 3, "r A4 C#4 E3")],
    ["wrong 4/3 seventh resolution", change(repeated, 4, "F#6 D5 A4 D3")],
    ["mixed final modes", change(route, 4, "F5 A4 D4 D3")],
  ])("withholds the new reading for %s", (_name, music) => {
    expect(analyze(music).proof(1)).toBeUndefined();
  });

  it("keeps the forward reading when the returning predominant is absent", () => {
    const { proof } = analyze(change(repeated, 5, home));
    expect(proof(1)).toBeDefined();
    expect(proof(6)).toBeUndefined();
  });

  it.each([2,3,4])("respects a phrase boundary at %i inside the corroboration", beat => {
    const { proof } = analyze(route, {}, p => p.structure.phraseBoundaries.push({
      id: "boundary", tick: beat * p.ppq, source: "manual", confidence: "certain",
    }));
    expect(proof(1)).toBeUndefined();
  });

  it("respects a written key event and an explicit nonchord note on the anchor", () => {
    expect(analyze(route, {}, p => p.keyEvents.push({ ...p.keyEvents[0], id: "other", tick: 3 * p.ppq })).proof(1)).toBeUndefined();
    expect(analyze(route, {}, p => { p.satbTracks[0].notes[3].nonChordToneRole = "neighbor"; }).proof(1)).toBeUndefined();
  });

  it("checks the full context when applying a clipped selection, preserving high confidence", () => {
    expect(analyze(route, { fromTick: 1440, toTick: 1920, minConfidence: "medium" }).r.regions).toMatchObject([
      { fromTick: 1440, toTick: 1920, status: "resolved", selected: { confidence: "medium" } },
    ]);
    expect(analyze(route, { minConfidence: "high", allowAbsoluteFallback: true }).proof(1)).toBeUndefined();
  });

  it("honors a locked contradictory chord at application without treating it as note evidence", () => {
    const { p, r, at } = analyze(route);
    const manual = { ...at(0)!, id: "held-label", startTick: p.ppq, durationTicks: p.ppq, locked: true };
    p.chordTrack.regions.push(manual);
    const incoming = inferHarmony(p);
    expect(incoming.chordInference.regions).toEqual(r.regions);
    for (const mode of ["fill-gaps", "replace-unlocked"] as const) {
      const applied = applyHarmonyInference(p, incoming, { mode });
      expect(applied.project.chordTrack.regions.find(c => c.startTick === p.ppq)).toEqual(manual);
    }
  });

  it("requires complete, properly spelled voices even with both legacy switches enabled", () => {
    for (const allowAbsoluteFallback of [true, false]) {
      for (const allowIncompleteVoicing of [true, false]) {
        const options = { allowAbsoluteFallback, allowIncompleteVoicing, allowNonChordToneCandidates: true };
        expect(analyze(change(route, 3, "E5 A4 Db4 E3"), options).proof(1)).toBeUndefined();
      }
    }
    expect(analyze(route, { allowAbsoluteFallback: true, minConfidence: "medium" }).proof(1)).toBeDefined();
  });

  it("a strong beat under a six-four cannot identify the weak passing chord", () => {
    const moved = [home,home,d2,six,passing,root,home,home];
    expect(analyze(moved).proof(2)).toBeUndefined();
  });

  it("leaves independent cadential key inference in control at a real phrase end", () => {
    const { at, proof } = analyze(repeated.slice(0, 8));
    expect(proof(1)).toBeUndefined();
    expect(at(7)?.semantics?.interpretations[0].localKey).toEqual({ tonic: { step: "D", alter: 0 }, mode: "major" });
  });

  it("still reports the cross-relation in the next harmony", () => {
    const { p, applied } = analyze(change(repeated, 8, "F5 C5 Db4 F3"));
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.cross-relation-successive", tick: 8 * p.ppq,
      noteIds: expect.arrayContaining(["note-S-6720", "note-T-7680"]),
    }));
  });

  it("keeps bass doubling in a real home SII6 and reports doubled root there", () => {
    const scores = ["F5 A4 D4 F3","D5 A4 D4 F3"];
    for (const [i,c] of scores.entries()) {
      const { p, applied, at } = analyze(["E5 G4 C4 C3",c,"D5 G4 B3 G3","E5 G4 C4 C3",home,home,home,home], {}, undefined, "C major");
      expect(at(1)?.semantics?.interpretations[0].degree).toBe(2);
      expect(checkHarmony(applied.project).diagnostics.some(d => d.tick === p.ppq &&
        d.ruleId === "chord.first-inversion-doubling")).toBe(i === 1);
    }
  });
});
