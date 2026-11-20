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

  const respeltScore = `satb 1
key D major
meter 2/4
bars 1..3 {
  S: | G5/4 F5/4 | F5/4 D#5/4 | D#5/4 C#5/4 |
  A: | C5/4 C5/4 | Bb4/4 A#4/4 | G#4/4 G#4/4 |
  T: | Eb4/4 D4/4 | Db4/4 B#3/4 | B3/4 A#3/4 |
  B: | A3/4 Ab3/4 | G3/4 F#3/4 | E#3/4 E3/4 |
}`;
  const diminished = "melody.diminished-interval";
  const atRespelling = (p: ProjectDocument) => events(p, diminished).filter(([tick]) => tick === 2880);
  const reportedThirds = [[2880, "soprano"], [2880, "tenor"]];

  it("accepts both respelt thirds at a whole-chord change in D major", () => {
    for (const labels of ["", '\nannotations {\nchord seam at=2:2 duration=1/4 symbol=viiø43 localKey="C# major"\n}']) {
      const project = compileScoreText(respeltScore + labels).project;
      expect(events(project)).toEqual([[4800, "bass"]]);
      expect(events(project, diminished)).toEqual([]);
    }
  });

  it("follows the diminished fifth into the root when an inner voice carries it", () => {
    const revoiced = respeltScore.replace("C5/4 C5/4 | Bb4/4 A#4/4 | G#4/4 G#4/4",
      "Eb5/4 D5/4 | Db5/4 B#4/4 | B4/4 A#4/4").replace("Eb4/4 D4/4 | Db4/4 B#3/4 | B3/4 A#3/4",
      "C4/4 C4/4 | Bb3/4 A#3/4 | G#3/4 G#3/4");
    const project = compileScoreText(revoiced).project;
    expect(atRespelling(project)).toEqual([]);
    project.satbTracks[3].notes[5].durationTicks /= 2;
    expect(atRespelling(project)).toEqual([[2880, "soprano"], [2880, "alto"]]);
  });

  const invalidSeams: [string, (p: ProjectDocument) => void][] = [
    ["only a partial respelling at the same sounding pitches", p => {
      p.satbTracks[1].notes[3].pitch = { step: "B", alter: -1, octave: 4 };
    }],
    ["octave-displaced inner voice at identical pitch classes", p => { p.satbTracks[1].notes[3].pitch.octave--; }],
    ["one missing tone after the seam", p => { p.satbTracks[1].notes.splice(4, 1); }],
    ["non-chord role on the common tone", p => { p.satbTracks[1].notes[3].nonChordToneRole = "passing"; }],
    ["a manual phrase break", p => {
      p.structure.phraseBoundaries.push({ id: "split", tick: 2880, source: "manual", confidence: "certain" });
    }],
    ["a written key change", p => {
      p.keyEvents.push({ ...p.keyEvents[0], id: "minor", tick: 2880, mode: "minor" });
    }],
    ["a second whole-chord respelling in the same six slots", p => {
      // Aø7 -> G double-sharp ø7 at identical absolute pitches.
      p.satbTracks[0].notes[0].pitch = { step: "F", alter: 2, octave: 5 };
      p.satbTracks[1].notes[0].pitch = { step: "B", alter: 1, octave: 4 };
      p.satbTracks[2].notes[0].pitch = { step: "D", alter: 1, octave: 4 };
      p.satbTracks[3].notes[0].pitch = { step: "G", alter: 2, octave: 3 };
    }],
  ];
  it.each(invalidSeams)("keeps both thirds with %s", (_reason, damage) => {
    const project = compileScoreText(respeltScore).project;
    damage(project);
    for (const event of reportedThirds) expect(atRespelling(project)).toContainEqual(event);
  });

  it.each(["V7", "viiø7"])("keeps both thirds under a conflicting %s annotation", symbol => {
    const labels = '\nannotations {\nchord seam at=2:2 duration=1/4 symbol=' + symbol + ' localKey="C# major"\n}';
    expect(atRespelling(compileScoreText(respeltScore + labels).project)).toEqual(reportedThirds);
  });

  it("keeps both thirds when the respelt arrival is the end of a six-chord chain", () => {
    const ending = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | G5/4 F5/4 | F5/4 Eb5/4 | Eb5/4 C#5/4 |
  A: | C5/4 C5/4 | Bb4/4 Bb4/4 | Ab4/4 G#4/4 |
  T: | Eb4/4 D4/4 | Db4/4 C4/4 | Cb4/4 A#3/4 |
  B: | A3/4 Ab3/4 | G3/4 Gb3/4 | F3/4 E3/4 |
}`;
    expect(events(compileScoreText(ending).project, diminished)).toEqual([[4800, "soprano"], [4800, "tenor"]]);
  });


  it("keeps both thirds when the change precedes the first corroborating fourth", () => {
    const start = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | Eb5/4 C#5/4 | C#5/4 B4/4 | B4/4 A4/4 |
  A: | Ab4/4 G#4/4 | F#4/4 F#4/4 | E4/4 E4/4 |
  T: | Cb4/4 A#3/4 | A3/4 G#3/4 | G3/4 F#3/4 |
  B: | F3/4 E3/4 | D#3/4 D3/4 | C#3/4 C3/4 |
}`;
    expect(events(compileScoreText(start).project, diminished)).toEqual([[960, "soprano"], [960, "tenor"]]);
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
