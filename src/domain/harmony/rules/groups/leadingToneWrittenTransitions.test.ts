import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";

const pivot = `satb 1
key B minor
meter 2/4
bars 1..3 {
 S: | C#5/4 B4/4 | G4/4. G4/8 | G4/4 C5/4 |
 A: | E4/4 D4/4 | E4/4. E4/8 | E4/4 F4/4 |
 T: | F#3/2 | C#4/4. Db4/8 | C4/2 |
 B: | A#2/4 B2/4 | A#2/4. Bb2/8 | Bb2/4 A2/4 |
}`;
const pivotLabels = `
annotations {
 chord c1 at=1:1 duration=1/4 symbol=D65
 chord c2 at=1:2 duration=1/4 symbol=t
 chord c3 range=[2:1,2:2+1/2) symbol=#viio7
 chord c4 at=2:2+1/2 duration=1/8 symbol=#viio43 localKey="F minor"
 chord c5 at=3:1 duration=1/4 symbol=D2 localKey="F major"
 chord c6 at=3:2 duration=1/4 symbol=T6 localKey="F major"
}`;
const pivotBeat = 3.5;
const majorPivot = pivot.replace("key B minor", "key B major").replace("E4/4 D4/4", "E4/4 D#4/4");
const majorPivotLabels = pivotLabels.replace("symbol=t", "symbol=T").replace("symbol=#viio7", "symbol=viio7");

const chain = `satb 1
key Ab major
meter 2/4
bars 1..2 {
 S: | G5/4. F#5/8 | F#5/4 E#5/4 |
 A: | Db5/4. B#4/8 | B#4/4 B4/4 |
 T: | Bb3/4. G#3/8 | G#3/2 |
 B: | Eb3/4. G#2/8 | G#2/4 C#3/4 |
}`;
const chainLabels = `
annotations {
 chord c1 range=[1:1,1:2+1/2) symbol=D7
 chord c2 range=[1:2+1/2,2:2) symbol=D7 localKey="C# major"
 chord c3 at=2:2 duration=1/4 symbol=D7 localKey="F# major"
}`;
const chainBeat = 1.5;

function throughEntry(score: string, labels: string, mode: "blind" | "given") {
  const project = compileScoreText(mode === "given" ? score + labels : score).project;
  if (mode === "given") return project;
  expect(project.chordTrack.regions).toHaveLength(0);
  return applyHarmonyInference(project, inferHarmony(project), {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

function warningAt(project: ProjectDocument, beat: number, voice: "soprano" | "alto" | "bass") {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "resolution.leading-tone" && d.tick === beat * project.ppq && d.voiceIds.includes(voice));
}

function expectWarning(project: ProjectDocument, beat: number, voice: "soprano" | "alto" | "bass", leadingTone: string) {
  expect(warningAt(project, beat, voice)).toMatchObject([{
    severity: "warning",
    voiceIds: [voice],
    params: { leadingTone },
    trace: [expect.objectContaining({ outcome: "continue", reason: "obligation-opened" }),
      expect.objectContaining({ outcome: "violate", reason: "leading-tone-moved-elsewhere" })],
  }]);
}

describe.each(["blind", "given"] as const)("E.1 written transitions through the %s entry", mode => {
  it("releases the original leading tone at a diminished pivot whose new dominant actually resolves", () => {
    expect(warningAt(throughEntry(pivot, pivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
  });

  it("requires the respelled bass to resolve as the new dominant's seventh, in its own voice", () => {
    const material = pivot.replace("A2/4 |", "A1/4 |");
    expectWarning(throughEntry(material, pivotLabels, mode), pivotBeat, "bass", "A♯");
  });

  it("uses the same full diminished pivot from harmonic major", () => {
    expect(warningAt(throughEntry(majorPivot, majorPivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
  });

  it("keeps the major-key obligation if the respelled bass skips its downward step", () => {
    const material = majorPivot.replace("A2/4 |", "A1/4 |");
    const project = throughEntry(material, majorPivotLabels, mode);
    expectWarning(project, pivotBeat, "bass", "A♯");
    expect(warningAt(project, pivotBeat, "bass")).toMatchObject([{ params: { key: "B major" } }]);
  });

  it("requires the new leading tone's resolution even when all tonic members still sound", () => {
    const material = pivot.replace("C5/4 |", "F5/4 |").replace("F4/4 |", "C4/4 |");
    expectWarning(throughEntry(material, pivotLabels, mode), pivotBeat, "bass", "A♯");
  });

  it("recognizes the change of spelling inside a witnessed dominant-seventh chain", () => {
    expect(warningAt(throughEntry(chain, chainLabels, mode), chainBeat, "soprano")).toHaveLength(0);
  });

  it("retains the warning when the next seventh is in the wrong octave", () => {
    const material = chain.replace("G5/4. F#5/8", "G5/4. F#4/8");
    expectWarning(throughEntry(material, chainLabels, mode), chainBeat, "soprano", "G");
  });

  it("keeps the warning when the adjoining chain link loses its same-voice exchange", () => {
    const material = chain.replace("F#5/4 E#5/4", "F#5/4 B5/4").replace("B#4/4 B4/4", "B#4/4 E#4/4");
    expectWarning(throughEntry(material, chainLabels, mode), chainBeat, "soprano", "G");
  });

  it.each([
    ["a held leading tone when another part reattacks", "G4/4. G4/8", "G4/8 G4/4 G4/8"],
    ["a same-pitch leading-tone reattack", "A#2/4. Bb2/8", "A#2/4 A#2/8 Bb2/8"],
    ["same-pitch reattacks in the new dominant", "E4/4 F4/4", "E4/8 E4/8 F4/4"],
  ])("verifies the pivot with %s", (_name, from, to) => {
    expect(warningAt(throughEntry(pivot.replace(from, to), pivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
  });

  it.each([
    ["a held leading tone when another part reattacks", "Db5/4. B#4/8", "Db5/8 Db5/4 B#4/8"],
    ["a same-pitch leading-tone reattack", "G5/4. F#5/8", "G5/4 G5/8 F#5/8"],
  ])("verifies the chain with %s", (_name, from, to) => {
    expect(warningAt(throughEntry(chain.replace(from, to), chainLabels, mode), chainBeat, "soprano")).toHaveLength(0);
  });

  it("uses the held source across a written reminder of the same key", () => {
    const material = chain.replace("meter 2/4", "meter 2/4\nat 1:1+1/2 key Ab major");
    const labels = chainLabels.replace("chord c1 range=[1:1,1:2+1/2) symbol=D7",
      "chord c1 at=1:1 duration=1/8 symbol=D7\n chord c1b range=[1:1+1/2,1:2+1/2) symbol=D7");
    expect(warningAt(throughEntry(material, labels, mode), chainBeat, "soprano")).toHaveLength(0);
  });
});

it("retains a wrong leading tone at an unlabelled tonic with the bass on its third", () => {
  const material = `satb 1
key A minor
meter 2/4
bars 1..1 {
 S: | B4/4 E5/4 |
 A: | G#4/4 E4/4 |
 T: | E4/4 A3/4 |
 B: | D3/4 C3/4 |
}`;
  const given = throughEntry(material, "\nannotations {\n chord c1 at=1:1 duration=1/4 symbol=D2\n}\n", "given");
  expect(given.chordTrack.regions).toHaveLength(1);
  expectWarning(given, 1, "alto", "G♯");
  expectWarning(throughEntry(material, "", "blind"), 1, "alto", "G♯");
});

it("does not borrow the new tonic past a manual phrase boundary", () => {
  const project = throughEntry(pivot, pivotLabels, "given");
  project.structure.phraseBoundaries.push({
    id: "break", tick: 5 * project.ppq, source: "manual", confidence: "certain",
  });
  expectWarning(project, pivotBeat, "bass", "A♯");
});

it("does not borrow a later tonic across a real score-key change", () => {
  const project = throughEntry(pivot, pivotLabels, "given");
  project.keyEvents.push({
    ...project.keyEvents[0], id: "changed-mode", tick: 4.5 * project.ppq, mode: "major",
  });
  expectWarning(project, pivotBeat, "bass", "A♯");
});

it("can verify the pivot from the written parts when the new harmonies are all unlabelled", () => {
  const oldKeyLabels = pivotLabels.replace(/ chord c4[\s\S]+}/, "}");
  const project = throughEntry(pivot, oldKeyLabels, "given");
  expect(project.chordTrack.regions).toHaveLength(3);
  expect(warningAt(project, pivotBeat, "bass")).toHaveLength(0);
});

it("keeps the obligation when the declared pivot does not agree with its written pitches", () => {
  const conflicting = pivotLabels.replace('localKey="F minor"', 'localKey="F# minor"');
  expectWarning(throughEntry(pivot, conflicting, "given"), pivotBeat, "bass", "A♯");
});

it("keeps the obligation when the next dominant is declared as a different harmony", () => {
  const conflicting = chainLabels.replace('symbol=D7 localKey="C# major"', 'symbol=T localKey="F major"');
  expectWarning(throughEntry(chain, conflicting, "given"), chainBeat, "soprano", "G");
});

it("continues to check a later leading tone after the exchange", () => {
  const material = chain.replace("bars 1..2", "bars 1..3")
    .replace("E#5/4 |", "E#5/4 | F#4/2 |").replace("B4/4 |", "B4/4 | A#4/2 |")
    .replace("G#3/2 |", "G#3/2 | C#4/2 |").replace("C#3/4 |", "C#3/4 | F#3/2 |");
  const labels = chainLabels.replace("}", ' chord c4 at=3:1 duration=1/2 symbol=T localKey="F# major"\n}');
  const project = throughEntry(material, labels, "given");
  expect(warningAt(project, chainBeat, "soprano")).toHaveLength(0);
  expectWarning(project, 4, "soprano", "E♯");
});
