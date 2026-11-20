import { describe, expect, it } from "vitest";
import type { ChordIdentity, ChordQuality } from "../../../chordModel";
import { parsePitchClass } from "../../../pitch";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { writtenLocalLeadingToneKey } from "./leadingToneTarget";

const rule = "resolution.leading-tone";
const seventh = `satb 1
key G major
meter 2/4
bars 1..1 {
 S: | F#4/4 B4/4 |
 A: | C#4/4 F#4/4 |
 T: | A#3/4 B3/4 |
 B: | E3/4 D#3/4 |
}`;
const triad = `satb 1
key A major
meter 2/4
bars 1..1 {
 S: | C#5/4 A4/4 |
 A: | G#4/4 F#4/4 |
 T: | C#4/4 C#4/4 |
 B: | E#3/4 F#3/4 |
}`;
const held = `satb 1
key G major
meter 3/4
bars 1..1 {
 S: | E#4/4 F#4/4 B4/4 |
 A: | C#4/2 F#4/4 |
 T: | A#3/2 F#3/4 |
 B: | E3/2 D#3/4 |
}`;

function compile(text: string, labels?: string) {
  const project = compileScoreText(labels ? text.replace("}", " H: | " + labels + " |\n}") : text).project;
  expect(validateProject(project)).toBe(true);
  return project;
}

function at(project: ProjectDocument, beats = 1) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === rule && d.tick === beats * project.ppq);
}

function identity(root: string, bass: string, quality: ChordQuality): ChordIdentity {
  return { root: parsePitchClass(root)!, bass: parsePitchClass(bass)!,
    structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

describe("E.1 collects the third of an independently observed local dominant", () => {
  it("uses the jointly written third and seventh in an unlabelled F-sharp dominant", () => {
    expect(at(compile(seventh))).toEqual([]);
  });

  it("uses the written inverted local dominant triad when its own leading tone resolves", () => {
    expect(at(compile(triad))).toEqual([]);
  });

  it("accepts matching authored absolute identities even on a locked track", () => {
    const project = compile(seventh, "D2/4 T/4");
    const [source, landing] = project.chordTrack.regions;
    source.identity = identity("F:1", "E:0", "dominant7");
    landing.identity = identity("B:0", "D:1", "major");
    source.semantics = undefined;
    landing.semantics = undefined;
    project.chordTrack.locked = true;
    expect(at(project)).toEqual([]);
  });

  it("a separately resolved seventh identifies the tonic but does not forgive a held inner third", () => {
    expect(at(compile(held), 2)).toMatchObject([{
      voiceIds: ["tenor"], params: { key: "B major", leadingTone: "A♯", targetTonic: "B" },
      trace: [
        { tick: 960, outcome: "continue", reason: "obligation-opened" },
        { tick: 1920, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
      ],
      noteIds: ["note-T-0", "note-T-1920"],
    }]);
  });

  it.each([
    ["the same pitch class only arrives in a different octave", triad.replace("E#3/4 F#3/4", "E#3/4 F#2/4")],
    ["the tonic is reached by another part", triad.replace("E#3/4 F#3/4", "E#3/4 C#3/4")],
    ["the destination is missing the fifth", triad.replace("A4/4", "F#4/4").replace("C#4/4 C#4/4", "C#4/4 A3/4")],
  ])("keeps the home-key warning when %s", (_name, text) => {
    expect(at(compile(text))).toMatchObject([{ voiceIds: ["alto"], params: { key: "A major" } }]);
  });

  it("a tonic third in the wrong voice cannot witness a seventh resolution", () => {
    const elsewhere = held.replace("C#4/2 F#4/4", "C#4/2 D#4/4").replace("E3/2 D#3/4", "E3/2 F#2/4");
    expect(at(compile(elsewhere), 2)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it("respects a given dominant identity that conflicts with the written F-sharp seventh", () => {
    const project = compile(seventh, "D2/4 r/4");
    expect(at(project)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it("keeps a confirmed local target rather than replacing its mode from the sounding arrival", () => {
    const badThird = seventh.replace("A#3/4 B3/4", "A#3/4 F#3/4");
    const project = compile(badThird, "D2/4 r/4");
    const source = project.chordTrack.regions[0];
    source.identity = identity("F:1", "E:0", "dominant7");
    const meaning = source.semantics!.interpretations[0];
    meaning.source = "confirmed";
    meaning.localKey = { tonic: parsePitchClass("B:0")!, mode: "minor" };
    expect(at(project)).toMatchObject([{ voiceIds: ["tenor"], params: { key: "B minor" } }]);
  });

  it("keeps a conflicting authored landing that declares the pivot as the next key's dominant", () => {
    const project = compile(seventh, "r/4 D6/4");
    const landing = project.chordTrack.regions[0];
    landing.identity = identity("B:0", "D:1", "major");
    landing.semantics!.interpretations[0].localKey = { tonic: parsePitchClass("E:0")!, mode: "minor" };
    expect(at(project)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it("accepts the same landing when its confirmed home degree names the actual root", () => {
    const project = compile(seventh, "r/4 D6/4");
    const landing = project.chordTrack.regions[0];
    landing.identity = identity("B:0", "D:1", "major");
    const meaning = landing.semantics!.interpretations[0];
    meaning.source = "confirmed";
    meaning.degree = 3;
    delete meaning.designation;
    delete meaning.localKey;
    expect(at(project)).toEqual([]);
  });

  it("cannot borrow a seventh marked as an ornament to justify a new key", () => {
    const project = compile(held);
    project.satbTracks.find(t => t.voice === "bass")!.notes[0].nonChordToneRole = "other";
    expect(at(project, 2)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it("does not borrow a resolution across a manual phrase boundary", () => {
    const project = compile(seventh);
    project.structure.phraseBoundaries.push({ id: "break", source: "manual", confidence: "certain", tick: project.ppq });
    expect(at(project)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it.each([[0.5], [1], [0.5, 1]])("survives a written-key reminder at %o", (...beats) => {
    const project = compile(seventh);
    for (const beat of beats) {
      project.keyEvents.push({ ...project.keyEvents[0], id: "reminder-" + beat, tick: beat * project.ppq });
    }
    expect(at(project)).toEqual([]);
  });

  it("does not infer the opening across a real change of key that returns before the landing", () => {
    for (const key of [{ tonic: parsePitchClass("D:0")!, mode: "major" as const },
                       { tonic: parsePitchClass("G:0")!, mode: "minor" as const }]) {
      const project = compile(seventh);
      project.keyEvents.push(
        { ...key, id: "new-key", tick: project.ppq / 4 },
        { ...project.keyEvents[0], id: "return", tick: project.ppq * 3 / 4 },
      );
      expect(validateProject(project)).toBe(true);
      const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
      expect(writtenLocalLeadingToneKey(rules, rules.sliceAt(0)!)).toBeUndefined();
    }
  });

  it("uses the true events across reattacks and does not collect at a reminder", () => {
    const material = held.replace("A#3/2 F#3/4", "A#3/4. A#3/8 F#3/4");
    const project = compile(material);
    project.keyEvents.push({ ...project.keyEvents[0], id: "same-key-middle", tick: project.ppq * 5 / 4 });
    expect(at(project, 2)).toMatchObject([{
      voiceIds: ["tenor"], params: { key: "B major" }, noteIds: ["note-T-0", "note-T-1920"],
      trace: [
        { tick: 960, outcome: "continue", reason: "obligation-opened" },
        { tick: 1200, outcome: "continue", reason: "leading-tone-repeated" },
        { tick: 1440, outcome: "continue", reason: "leading-tone-repeated" },
        { tick: 1920, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
      ],
    }]);
    const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    expect(writtenLocalLeadingToneKey(rules, rules.sliceAt(1200)!)).toBeUndefined();
  });

  it("cannot borrow the later dominant proof after an actual intervening pitch change", () => {
    const project = compile(seventh.replace("F#4/4 B4/4", "F#4/16 F4/16 F#4/8 B4/4"));
    expect(at(project, 0.25)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
    expect(at(project)).toEqual([]);
  });
});

describe("Written role and attained tonic", () => {
  it("retargets the apparent home leading tone when it is the root of a local dominant triad", () => {
    const bareTriad = seventh.replace("E3/4 D#3/4", "F#3/4 D#3/4");
    expect(at(compile(bareTriad))).toEqual([]);
  });

  it("retargets the apparent home leading tone when it is the seventh of the local dominant", () => {
    const lowered = `satb 1
key C major
meter 2/4
bars 1..1 {
 S: | E#5/4 F#5/4 |
 A: | G#4/4 C#5/4 |
 T: | C#4/2 |
 B: | B2/4 A2/4 |
}`;
    expect(at(compile(lowered))).toEqual([]);
  });

  it("reads the doubled-root dominant seventh with an omitted fifth, as in L075", () => {
    const material = `satb 1
key A minor
meter 2/4
bars 1..1 {
 S: | B#4/4 C#5/4 |
 A: | F#4/4 E4/4 |
 T: | G#3/2 |
 B: | G#2/4 C#3/4 |
}`;
    expect(at(compile(material))).toEqual([]);
    const wrongThird = material.replace("B#4/4 C#5/4", "B#4/4 G#4/4");
    expect(at(compile(wrongThird))).toMatchObject([{
      voiceIds: ["soprano"], params: { key: "C♯ minor", leadingTone: "B♯" },
    }]);
  });

  it("requires both independent resolutions into an incomplete tonic on its own bass", () => {
    const incomplete = `satb 1
key E minor
meter 2/4
bars 1..1 {
 S: | B#4/4 C#5/4 |
 A: | F#4/4 E4/4 |
 T: | G#3/4 C#4/4 |
 B: | D#3/4 C#3/4 |
}`;
    expect(at(compile(incomplete))).toEqual([]);
    const wrongThird = incomplete.replace("B#4/4 C#5/4", "B#4/4 E5/4");
    expect(at(compile(wrongThird))).toMatchObject([{ voiceIds: ["bass"], params: { key: "E minor" } }]);
  });

  it("respects a mid-voicing chord declaration that conflicts with the witnessed harmony", () => {
    const conflict = compile(seventh, "r/8 D2/8 r/4");
    expect(at(conflict)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
    const same = compile(seventh, "r/8 D2/8 r/4");
    const region = same.chordTrack.regions[0];
    region.identity = identity("F:1", "E:0", "dominant7");
    region.semantics = undefined;
    expect(at(same)).toEqual([]);
  });
});
