import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { checkHarmony } from "../../registry";

const ruleId = "chord.second-inversion-voicing";

function score(minor = true) {
  return compileScoreText(minor ? `satb 1
key C minor
meter 4/4
bars 1..1 {
  S: | C5/1 |
  A: | Eb4/8 E4/8 F4/4 Eb4/2 |
  T: | C4/8 Bb3/8 Ab3/4 G3/2 |
  B: | C3/1 |
  H: | i/8 r/8 iv64/4 i/2 |
}` : `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | F4/8 F4/8 F4/4 F4/2 |
  A: | C4/8 Eb4/8 Db4/4 C4/2 |
  T: | A3/8 A3/8 Bb3/4 A3/2 |
  B: | F2/1 |
  H: | I/8 r/8 iv64/4 I/2 |
}`).project;
}

function warnings(project: ProjectDocument, tick: number = project.ppq) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId && d.tick === tick);
}

describe("subdominant six-four within a written tonic pedal", () => {
  it.each([true, false])("recognizes the tonic pedal with minor=%s", minor => {
    expect(warnings(score(minor))).toHaveLength(0);
  });

  it("allows blank flanking labels when the local key and all the pitches agree", () => {
    const project = score();
    project.chordTrack.regions = project.chordTrack.regions.filter(c => c.startTick === project.ppq);
    expect(warnings(project)).toHaveLength(0);
  });

  const breaks: [string, (p: ProjectDocument) => void][] = [
    ["missing prepared tonic third", p => { p.satbTracks[1].notes[0].pitch = { step: "G", alter: 0, octave: 4 }; }],
    ["wrong preceding applied chord", p => { p.satbTracks[1].notes[1].pitch.alter = -1; }],
    ["enharmonic spelling of the preceding leading note", p => {
      p.satbTracks[1].notes[1].pitch = { step: "F", alter: -1, octave: 4 };
    }],
    ["unresolved seventh in its original voice", p => {
      p.satbTracks[2].notes[2].pitch.octave--;
    }],
    ["broken upper pedal octave", p => {
      const soprano = p.satbTracks[0].notes[0];
      const duration = soprano.durationTicks;
      soprano.durationTicks = p.ppq;
      p.satbTracks[0].notes.push({
        ...soprano, id: "registral-change", startTick: p.ppq, durationTicks: duration - p.ppq,
        pitch: { ...soprano.pitch, octave: soprano.pitch.octave + 1 },
      });
    }],
    ["rearticulated bass", p => {
      const bass = p.satbTracks[3].notes[0];
      const split = p.ppq;
      p.satbTracks[3].notes.push({ ...bass, id: "bass-return", startTick: split, durationTicks: bass.durationTicks - split });
      bass.durationTicks = split;
    }],
    ["immediate tonic replaced by a different mode", p => {
      p.chordTrack.regions.pop();
      p.satbTracks[1].notes[3].pitch.alter = 0;
    }],
    ["separate complete alternative before the written tonic returns", p => {
      const split = 2 * p.ppq;
      const eighth = p.ppq / 2;
      const [, alto, tenor] = p.satbTracks;
      p.chordTrack.regions.pop();
      for (const [track, step] of [[alto, "E"], [tenor, "A"]] as const) {
        const tonic = track.notes[3];
        tonic.startTick += eighth;
        tonic.durationTicks -= eighth;
        track.notes.splice(3, 0, {
          ...tonic, id: "intervening-" + step, startTick: split, durationTicks: eighth,
          pitch: { ...tonic.pitch, step, alter: -1 },
        });
      }
    }],
    ["new written key at the return", p => {
      p.keyEvents.push({ ...p.keyEvents[0], id: "new-key", tick: p.ppq * 2, mode: "major" });
    }],
    ["contradictory local key in an existing label", p => {
      const tonic = p.chordTrack.regions[2];
      tonic.semantics = { ...tonic.semantics!, interpretations: tonic.semantics!.interpretations.map(reading =>
        ({ ...reading, localKey: { tonic: { step: "F", alter: 0 }, mode: "minor" } })) };
    }],
    ["return fully voiced but approached by leaps", p => {
      const [, alto, tenor] = p.satbTracks;
      [alto.notes[3].pitch, tenor.notes[3].pitch] = [tenor.notes[3].pitch, alto.notes[3].pitch];
    }],
  ];
  it.each(breaks)("retains the configuration warning with %s", (_name, change) => {
    const project = score();
    change(project);
    expect(warnings(project)).toHaveLength(1);
  });

  it.each([0.5, 1, 2])("respects a phrase edge at quarter position %s", beat => {
    const project = score();
    project.structure.phraseBoundaries.push({
      id: "manual-edge", tick: project.ppq * beat, confidence: "certain", source: "manual",
    });
    expect(warnings(project)).toHaveLength(1);
  });

  it("retains the warning on a secondary accent with otherwise identical motion", () => {
    const project = score();
    const ppq = project.ppq;
    const events = [...project.satbTracks.flatMap(track => track.notes), ...project.chordTrack.regions];
    for (const event of events) {
      if (event.startTick + event.durationTicks === ppq * 4) event.durationTicks -= ppq;
      event.startTick += ppq;
    }
    expect(warnings(project, ppq * 2)).toHaveLength(1);
  });

  it("still checks the required bass doubling in a genuine K46–D–T", () => {
    const project = compileScoreText(`satb 1
key G major
meter 4/4
bars 1..1 {
  S: | B4/4 A4/4 G4/2 |
  A: | G4/4 F#4/4 G4/2 |
  T: | D4/4 D4/4 B3/2 |
  B: | D3/2 G2/2 |
  H: | K46/4 D/4 T/2 |
}`).project;
    expect(warnings(project, 0)).toHaveLength(0);
    project.satbTracks[2].notes[0].pitch = { step: "G", alter: 0, octave: 3 };
    expect(warnings(project, 0)).toHaveLength(1);
  });
});
