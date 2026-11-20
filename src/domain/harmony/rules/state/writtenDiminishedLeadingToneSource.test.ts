import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../index";

const cases = [
  {
    name: "B-flat major with a first-inversion C-sharp diminished seventh",
    key: "Bb major",
    labels: "DDVII7/4 r/4",
    parts: ["C#5/4", "G4/4 F#4/4", "Bb3/4 A3/4", "E3/4 D3/4"],
    resolved: "D5",
    wrong: "A4",
    inferredVoice: "bass",
    inferredTonic: "F",
    leadingTone: "C♯",
    tonic: "D",
    mode: "major",
  },
  {
    name: "C major with a third-inversion D-sharp diminished seventh",
    key: "C major",
    labels: "DDVII43/4 r/4",
    parts: ["D#5/4", "A4/4 G4/4", "F#3/4 E3/4", "C3/4 B2/4"],
    resolved: "E5",
    wrong: "B4",
    inferredVoice: "tenor",
    inferredTonic: "G",
    leadingTone: "D♯",
    tonic: "E",
    mode: "minor",
  },
] as const;

function score(example: (typeof cases)[number], soprano: string, tenor: string = example.parts[2]) {
  return compileScoreText(`satb 1
key ${example.key}
meter 2/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${example.parts[1]} |
 T: | ${tenor} |
 B: | ${example.parts[3]} |
 H: | ${example.labels} |
}`).project;
}

function inferred(project: ProjectDocument) {
  // Exercise rule checking with the enharmonically rotated upstream interpretation.
  project.chordTrack.regions[0].semantics!.interpretations[0].source = "inferred";
  return project;
}

function warnings(project: ProjectDocument) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.leading-tone")
    .map(({ tick, severity, voiceIds, noteIds, params }) => ({ tick, severity, voiceIds, noteIds, params }));
}

describe("E.1 sources for an inferred enharmonic diminished seventh", () => {
  it.each(cases)("uses the written root and the attained tonic in $name", example => {
    const [opening] = example.parts;
    const resolved = inferred(score(example, `${opening} ${example.resolved}/4`));
    expect(warnings(resolved)).toEqual([]);

    const unresolved = inferred(score(example, `${opening} ${example.wrong}/4`));
    expect(warnings(unresolved)).toMatchObject([{
      tick: unresolved.ppq,
      severity: "warning",
      voiceIds: ["soprano"],
      noteIds: ["note-S-0", `note-S-${unresolved.ppq}`],
      params: { key: `${example.tonic} ${example.mode}`, leadingTone: example.leadingTone, targetTonic: example.tonic },
    }]);
  });

  it.each(["manual", "locked region", "locked track"])("respects the %s interpretation", origin => {
    const example = cases[0];
    const project = score(example, `${example.parts[0]} ${example.wrong}/4`);
    if (origin !== "manual") {
      inferred(project);
      if (origin === "locked region") project.chordTrack.regions[0].locked = true;
      if (origin === "locked track") project.chordTrack.locked = true;
    }
    expect(warnings(project)).toMatchObject([{
      tick: project.ppq,
      voiceIds: [example.inferredVoice],
      params: { targetTonic: example.inferredTonic },
    }]);
  });

  it.each(["r", "G3"])("keeps inferred behavior if %s replaces a member of the seventh", replacement => {
    const example = cases[0];
    const project = inferred(score(example, `${example.parts[0]} ${example.wrong}/4`, `${replacement}/4 A3/4`));
    expect(warnings(project)).toMatchObject([{
      tick: project.ppq,
      voiceIds: [example.inferredVoice],
      params: { targetTonic: example.inferredTonic },
    }]);
  });

  it("keeps the inferred target when its diminished seventh agrees with the written spelling", () => {
    const example = cases[0];
    const project = inferred(score(example, "Db5/4 A4/4"));
    expect(warnings(project)).toMatchObject([{
      tick: project.ppq,
      voiceIds: [example.inferredVoice],
      params: { targetTonic: example.inferredTonic },
    }]);
  });

  it("drops the contradicted target without reading a local tonic across a manual phrase boundary", () => {
    const example = cases[0];
    const project = inferred(score(example, `${example.parts[0]} ${example.wrong}/4`));
    project.structure.phraseBoundaries.push({
      id: "phrase-break", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(warnings(project)).toEqual([]);
  });
});
