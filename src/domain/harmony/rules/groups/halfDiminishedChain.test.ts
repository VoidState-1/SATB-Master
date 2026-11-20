import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { checkHarmony } from "../../registry";

const score = `satb 1
key D major
meter 2/4
bars 1..3 {
  S: | B5/4 A5/4 | A5/4 G5/4 | G5/4 F5/4 |
  A: | E5/4 E5/4 | D5/4 D5/4 | C5/4 C5/4 |
  T: | G4/4 F#4/4 | F4/4 E4/4 | Eb4/4 D4/4 |
  B: | C#4/4 C4/4 | B3/4 Bb3/4 | A3/4 Ab3/4 |
}`;
const head = "chord head at=1:1 duration=1/4 symbol=viiø7";
const example = (labels = head) => compileScoreText(score + "\nannotations {\n" + labels + "\n}").project;
const augmented = "melody.augmented-interval";
const leading = "resolution.leading-tone";

function events(project: ProjectDocument, ruleId = augmented) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId)
    .map(d => [d.tick, ...d.voiceIds]);
}

describe("half-diminished seventh chain in ascending fourths", () => {
  it("accepts the internal written semitone in alternating voices, with sparse or absent labels", () => {
    for (const project of [example(), compileScoreText(score).project]) {
      expect(events(project)).toEqual([[4800, "bass"]]);
    }
  });

  it("retains the leading-tone obligation on the same note as an accepted chromatic step", () => {
    expect(events(example(), leading)).toContainEqual([960, "bass"]);
  });

  const breaks: [string, (p: ProjectDocument) => void][] = [
    ["missing seventh", p => { p.satbTracks[0].notes.splice(2, 1); }],
    ["enharmonic misspelling", p => { p.satbTracks[2].notes[2].pitch = { step: "E", alter: 1, octave: 4 }; }],
    ["wrong voice motion at the same pitch classes", p => { p.satbTracks[2].notes[2].pitch.octave++; }],
    ["non-chord tone in an accompanying voice", p => { p.satbTracks[1].notes[3].nonChordToneRole = "passing"; }],
    ["gap inside the last corroborating slot", p => { p.satbTracks[0].notes[5].durationTicks /= 2; }],
    ["manual phrase ending", p => {
      p.structure.phraseBoundaries.push({ id: "end", tick: 960, source: "manual", confidence: "certain" });
    }],
    ["new written key", p => {
      p.keyEvents.push({ ...p.keyEvents[0], id: "new-key", tick: 2880, mode: "minor" });
    }],
  ];
  it.each(breaks)("keeps the first warning with a %s", (_name, change) => {
    const project = example();
    change(project);
    expect(events(project)).toContainEqual([960, "bass"]);
  });

  it("checks an explicit chord identity and inversion against the actual notes", () => {
    const chord = (symbol: string) => head + "\nchord copy at=2:1 duration=1/4 symbol=" + symbol + ' localKey="C major"';
    expect(events(example(chord("viiø7")))).not.toContainEqual([960, "bass"]);
    for (const symbol of ["viiø43", "V7", "iiø7"]) {
      expect(events(example(chord(symbol)))).toContainEqual([960, "bass"]);
    }
  });

  it("reports the written chromatic step and unresolved leading tone of an ordinary dominant seventh", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | B4/4 Bb4/4 | G4/2 |
  A: | F4/2 | E4/2 |
  T: | D4/2 | C4/2 |
  B: | G3/4 A3/4 | C3/2 |
  H: | V7/4 ii/4 | I/2 |
}`).project;
    expect(events(project)).toContainEqual([960, "soprano"]);
    expect(events(project, leading)).toContainEqual([960, "soprano"]);
  });

  it("separates two respelt thirds from the surrounding written unisons", () => {
    const project = compileScoreText(`satb 1
key D major
meter 2/4
bars 1..3 {
  S: | G5/4 F5/4 | F5/4 D#5/4 | D#5/4 C#5/4 |
  A: | C5/4 C5/4 | Bb4/4 A#4/4 | G#4/4 G#4/4 |
  T: | Eb4/4 D4/4 | Db4/4 B#3/4 | B3/4 A#3/4 |
  B: | A3/4 Ab3/4 | G3/4 F#3/4 | E#3/4 E3/4 |
}`).project;
    expect(events(project)).toEqual([[4800, "bass"]]);
    expect(events(project, "melody.diminished-interval")).toEqual([
      [2880, "soprano"], [2880, "tenor"],
    ]);
  });

  it("checks the last half-diminished chord and its real tonic resolution", () => {
    const text = score.replace("D major", "Ab major").replace("1..3", "1..4")
      .replace("G5/4 F5/4 |", "G5/4 F5/4 | F5/4 Eb5/4 |")
      .replace("C5/4 C5/4 |", "C5/4 C5/4 | Bb4/4 C5/4 |")
      .replace("Eb4/4 D4/4 |", "Eb4/4 D4/4 | Db4/4 Eb4/4 |")
      .replace("A3/4 Ab3/4 |", "A3/4 Ab3/4 | G3/4 Ab3/4 |");
    const labels = "\nannotations {\nchord terminal at=4:1 duration=1/4 symbol=viiø7\nchord tonic at=4:2 duration=1/4 symbol=I\n}";
    const resolved = compileScoreText(text + labels).project;
    expect(events(resolved)).toContainEqual([5760, "tenor"]);
    expect(events(resolved, leading)).not.toContainEqual([6720, "bass"]);
    const broken = compileScoreText(text.replace("G3/4 Ab3/4", "G3/4 C3/4")
      .replace("Db4/4 Eb4/4", "Db4/4 Ab3/4") + labels.replace("symbol=I\n", "symbol=I6\n")).project;
    expect(events(broken, leading)).toContainEqual([6720, "bass"]);
  });
});
