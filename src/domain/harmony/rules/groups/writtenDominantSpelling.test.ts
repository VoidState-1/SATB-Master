import { describe, expect, it } from "vitest";
import type { ChordIdentity, ChordQuality, HarmonyInterpretation } from "../../../chordModel";
import { parsePitchClass } from "../../../pitch";
import type { NonChordToneRole, VoiceId } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const ruleId = "melody.augmented-interval";
const spelling = {
  severity: "warning", messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("C♯"),
};
const warning = { severity: "warning", messageKey: ruleId + ".增" };

interface Annotation {
  source: HarmonyInterpretation["source"];
  locked: boolean;
  absoluteOnly?: boolean;
  trackLocked?: boolean;
  conflict?: "middle" | "enharmonic-goal";
}

function identity(root: string, bass: string, quality: ChordQuality): ChordIdentity {
  return {
    root: parsePitchClass(root)!, bass: parsePitchClass(bass)!,
    structure: { kind: "tertian", quality, extensions: [], alterations: [] },
  };
}

interface RoleMark {
  voice: VoiceId;
  tick: number;
  role: NonChordToneRole;
}

function entry(
  middle = "C#4", soprano = "A4", annotation?: Annotation, landingBass = "F3", mark?: RoleMark,
) {
  const score = [
    "satb 1", "key D minor", "meter 3/4", "bars 1..1 {",
    " S: | A4/2 " + soprano + "/4 |",
    " A: | F4/4 E4/4 F4/4 |",
    " T: | C4/4 " + middle + "/4 D4/4 |",
    " B: | A3/4 G3/4 " + landingBass + "/4 |",
    ...(annotation ? [" H: | i/4 iv/4 V/4 |"] : []),
    "}",
  ].join("\n");
  const { project } = compileScoreText(score);
  if (annotation) {
    project.chordTrack.locked = annotation.trackLocked ?? false;
    const identities = [identity("F:0", "A:0", "major"), identity("A:0", "G:0", "dominant7"), identity("D:0", "F:0", "minor")];
    if (annotation.conflict === "middle") identities[1] = identity("B:-1", "D:0", "major");
    if (annotation.conflict === "enharmonic-goal") identities[2] = identity("E:-2", "G:-2", "minor");
    for (const [index, chord] of project.chordTrack.regions.entries()) {
      chord.identity = identities[index];
      chord.locked = annotation.locked;
      // Keep the deliberately unrelated functional labels; the absolute identities above carry the declaration.
      if (annotation.absoluteOnly) delete chord.semantics;
      else for (const reading of chord.semantics!.interpretations) reading.source = annotation.source;
    }
  }
  if (mark) markRole(project, mark);
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("tenor"));
}

function markRole(project: ReturnType<typeof compileScoreText>["project"], mark: RoleMark) {
  const track = project.satbTracks.find(track => track.voice === mark.voice)!;
  const note = track.notes.find(note => note.startTick === mark.tick)!;
  note.nonChordToneRole = mark.role;
}

describe("Structural spelling from written dominant resolution", () => {
  it("reads spelling from the played four parts without annotations", () => {
    expect(entry()).toEqual([]);
    expect(entry("Db4")).toMatchObject([spelling]);
  });

  it.each([
    { source: "inferred", locked: false },
    { source: "inferred", locked: false, trackLocked: true },
    { source: "inferred", locked: false, absoluteOnly: true },
    { source: "manual", locked: false },
    { source: "inferred", locked: true },
    { source: "manual", locked: true },
    { source: "confirmed", locked: false },
  ] satisfies Annotation[])("uses the same spelling with an identical absolute identity: %o", annotation => {
    expect(entry("C#4", "A4", annotation)).toEqual([]);
    expect(entry("Db4", "A4", annotation)).toMatchObject([spelling]);
  });

  it.each([
    { source: "manual", locked: false, conflict: "middle" },
    { source: "inferred", locked: false, trackLocked: true, conflict: "middle" },
    { source: "inferred", locked: false, absoluteOnly: true, conflict: "middle" },
    { source: "inferred", locked: true, conflict: "middle" },
    { source: "manual", locked: false, conflict: "enharmonic-goal" },
  ] satisfies Annotation[])("preserves the warning when an explicit written identity conflicts: %o", annotation => {
    expect(entry("C#4", "A4", annotation)).toMatchObject([warning]);
  });

  it("ignores an unlocked inferred identity that contradicts the performed one", () => {
    const inferred = { source: "inferred", locked: false, conflict: "middle" } as const;
    expect(entry("C#4", "A4", inferred)).toEqual([]);
    expect(entry("Db4", "A4", inferred)).toMatchObject([spelling]);
  });

  it("keeps the warning for a diminished landing even if a manual tonic is given", () => {
    expect(entry("C#4", "Ab4")).toMatchObject([warning]);
    expect(entry("C#4", "Ab4", { source: "manual", locked: false })).toMatchObject([warning]);
  });

  it("keeps the unison warning when the seventh reaches the tonic third in the wrong octave", () => {
    expect(entry("C#4", "A4", undefined, "F2")).toMatchObject([warning]);
  });

  it.each([
    { voice: "tenor", tick: 0, role: "passing" },
    { voice: "tenor", tick: 960, role: "neighbor" },
    { voice: "tenor", tick: 1920, role: "suspension" },
    { voice: "bass", tick: 960, role: "anticipation" },
  ] satisfies RoleMark[])("keeps the existing adjudication when a required note has an ornamental role: %o", mark => {
    expect(entry("C#4", "A4", undefined, "F3", mark)).toMatchObject([warning]);
    expect(entry("Db4", "A4", undefined, "F3", mark)).toEqual([]);
  });

  it("still reads the spelling if a redundant goal note in another voice has an ornamental role", () => {
    const mark = { voice: "alto", tick: 1920, role: "other" } as const;
    expect(entry("C#4", "A4", undefined, "F3", mark)).toEqual([]);
    expect(entry("Db4", "A4", undefined, "F3", mark)).toMatchObject([spelling]);
  });

  it("can establish the goal without a redundant following note in the inspected voice", () => {
    const { project } = compileScoreText([
      "satb 1", "key E major", "meter 3/4", "bars 1..1 {",
      " S: | C#5/4 B4/4 E5/4 |", " A: | E#4/4 E4/4 E4/4 |",
      " T: | G#3/2 A3/4 |", " B: | C#3/4 D3/4 C#3/4 |", "}",
    ].join("\n"));
    markRole(project, { voice: "alto", tick: 1920, role: "other" });
    expect(checkHarmony(project).diagnostics.some(d =>
      d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("alto"))).toBe(false);
  });

  it.each([1920, 2400])("checks an early seventh resolution even before the tonic onset: %s", tick => {
    const { project } = compileScoreText([
      "satb 1", "key C minor", "meter 4/4", "bars 1..1 {",
      " S: | C5/4 Bb4/8 C5/8 Bb4/8 A4/8 A4/4 |", " A: | G4/2. F#4/4 |",
      " T: | Eb4/4 E4/2 D4/4 |", " B: | C3/4 C#3/2 D3/4 |", "}",
    ].join("\n"));
    const warns = () => checkHarmony(project).diagnostics.some(d =>
      d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("tenor"));
    expect(warns()).toBe(false);
    markRole(project, { voice: "soprano", tick, role: "neighbor" });
    expect(warns()).toBe(true);
  });

  it("does not respell an ornamental lower neighbor as the minor third of a stationary chord", () => {
    const score = [
      "satb 1", "key Bb minor", "meter 4/4", "bars 1..1 {",
      " S: | F5/1 |",
      " A: | A4/4 G#4/4 A4/4 Bb4/4 |",
      " T: | C4/2. Bb3/4 |",
      " B: | F3/2 Eb3/4 Db3/4 |",
      "}",
    ].join("\n");
    const { project } = compileScoreText(score);
    expect(checkHarmony(project).diagnostics.some(d =>
      d.ruleId === ruleId && d.tick === project.ppq * 2 && d.voiceIds.includes("alto"))).toBe(false);
  });
});
