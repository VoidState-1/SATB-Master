import { describe, expect, it } from "vitest";
import type { ChordIdentity, ChordQuality } from "../../../../chordModel";
import { parsePitchClass } from "../../../../pitch";
import { validateProject } from "../../../../project";
import { type ProjectDocument, PPQ } from "../../../../project/types";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { applyHarmonyInference, inferHarmony } from "../../../index";
import { checkHarmony } from "../../../registry";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import {
  writtenLocalLeadingToneKey,
  accentedOrnamentOverWrittenTriad,
  leadingNeighborFrame,
} from "../leadingToneTargets";

const leading = "resolution.leading-tone";
const seventh = "resolution.chord-seventh";

function score(
  key: string,
  parts: readonly string[],
  { labels, meter = "2/4", annotations }: { labels?: string; meter?: string; annotations?: string } = {},
) {
  const project = compileScoreText(`satb 1
key ${key}
meter ${meter}
bars 1..1 {
${[..."SATB"].map((voice, index) => ` ${voice}: ${parts[index] ? `| ${parts[index]} |` : "empty"}`).join("\n")}
${labels ? ` H: | ${labels} |` : ""}
}
${annotations ? `annotations {\n${annotations}\n}` : ""}`).project;
  expect(validateProject(project)).toBe(true);
  return project;
}

function blindWriteback(input: ProjectDocument) {
  expect(input.chordTrack.regions).toEqual([]);
  const { project } = applyHarmonyInference(input, inferHarmony(input), {
    mode: "replace-unlocked",
    writeNonChordToneRoles: true,
  });
  expect(validateProject(project)).toBe(true);
  return project;
}

function resolutions(project: ProjectDocument, ruleId: typeof leading | typeof seventh) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === ruleId);
}

function expectSeventhWarnings(project: ProjectDocument, semitones?: number) {
  expect(resolutions(project, seventh)).toMatchObject(semitones === undefined ? [] : [{
    tick: project.ppq,
    voiceIds: ["soprano"],
    noteIds: ["note-S-0", `note-S-${project.ppq}`],
    params: { resolutionSemitones: semitones },
  }]);
}

function expectLeadingWarning(project: ProjectDocument, fromBeat: number, toBeat: number, targetTonic: string) {
  const warnings = resolutions(project, leading);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({
    tick: toBeat * project.ppq,
    voiceIds: ["soprano"],
    severity: "warning",
    params: { targetTonic },
    trace: expect.arrayContaining([
      { tick: fromBeat * project.ppq, outcome: "continue", reason: "obligation-opened" },
      { tick: toBeat * project.ppq, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
    ]),
  });
}

describe("E.1 leading-tone source", () => {
  it.each([
    ["A4", undefined],
    ["C5", 1],
  ] as const)("the seventh of a labelled major tonic seventh moves to %s", (landing, semitones) => {
    // Score text uses I7 for the major tonic seventh.
    const project = score("C major", [
      `B4/4 ${landing}/4`, "G4/4 F4/4", "E4/4 C4/4", "C3/4 F3/4",
    ], { labels: "I7/4 IV/4" });

    expect(resolutions(project, leading)).toEqual([]);
    expectSeventhWarnings(project, semitones);
  });

  it("blind writeback preserves the passing tonic seventh without opening E.1", () => {
    const project = blindWriteback(score("D major", [
      "D5/2 D5/4", "A4/2 B4/4", "F#4/2 F#4/4", "D3/4 C#3/4 B2/4",
    ], { meter: "3/4" }));

    expect(project.chordTrack.regions.find(chord => chord.startTick === project.ppq)).toMatchObject({
      identity: { root: { step: "D", alter: 0 }, bass: { step: "C", alter: 1 }, structure: { quality: "major7" } },
    });
    expect(resolutions(project, leading)).toEqual([]);
    expect(resolutions(project, seventh)).toEqual([]);
  });

  it.each(["given", "blind writeback"] as const)("III's fifth and V's third differ with %s chords", entry => {
    for (const dominant of [false, true]) {
      const input = score("C major", [
        "B4/4 E5/4", "G4/2", dominant ? "D4/4 C4/4" : "E4/4 C4/4",
        dominant ? "G2/4 C3/4" : "E3/4 C3/4",
      ], { labels: entry === "given" ? (dominant ? "V/4 I/4" : "DTIII/4 I/4") : undefined });
      const project = entry === "given" ? input : blindWriteback(input);
      expect(project.chordTrack.regions[0]).toMatchObject({
        startTick: 0,
        identity: {
          root: { step: dominant ? "G" : "E", alter: 0 },
          structure: { quality: dominant ? "major" : "minor" },
        },
        ...(!dominant && entry === "given" && {
          semantics: { interpretations: [{ designation: { primaryFunction: "dominant", secondaryFunction: "tonic" } }] },
        }),
      });
      if (dominant) {
        expectLeadingWarning(project, 0, 1, "C");
      } else {
        expect(resolutions(project, leading)).toEqual([]);
      }
    }
  });

  it.each([
    ["Bb4", undefined],
    ["D5", 2],
  ] as const)("the local minor tonic's natural VII moves to %s", (landing, semitones) => {
    const project = score("Bb major", [
      `C5/4 ${landing}/4`, "F4/4 G4/4", "A3/4 D4/4", "D3/4 Bb2/4",
    ], { annotations: `
      chord source at=1:1 duration=1/4 symbol=i7 localKey="D minor"
      chord destination at=1:2 duration=1/4 symbol=s6 localKey="D minor"` });
    expect(project.chordTrack.regions[0]).toMatchObject({
      identity: { structure: { quality: "minor7" } },
      semantics: { interpretations: [{ degree: 1, localKey: { mode: "minor", tonic: { step: "D", alter: 0 } } }] },
    });

    expect(resolutions(project, leading)).toEqual([]);
    expectSeventhWarnings(project, semitones);
  });

  it.each([
    ["complete V", "G4/4 A4/4", "C3/4 F3/4", true],
    ["incomplete four-part writing", "C5/4 A4/4", "C3/4 F3/4", false],
    ["complete iii", "A4/4 A4/4", "A3/4 F3/4", false],
  ] as const)("unlabelled %s with the same E5 departure", (_source, alto, bass, owesResolution) => {
    const input = score("F major", [
      "E5/4 C5/4", alto, "C4/2", bass,
    ]);
    expect(input.chordTrack.regions).toEqual([]);

    if (owesResolution) {
      expectLeadingWarning(input, 0, 1, "F");
      expectLeadingWarning(blindWriteback(input), 0, 1, "F");
      const resolved = score("F major", ["E5/4 F5/4", alto, "C4/2", bass]);
      expect(resolutions(resolved, leading)).toEqual([]);
      expect(resolutions(blindWriteback(resolved), leading)).toEqual([]);
    } else {
      expect(resolutions(input, leading)).toEqual([]);
      expect(resolutions(blindWriteback(input), leading)).toEqual([]);
    }
  });

  it.each(["C5", "F5"] as const)("the written leading-tone triad still tests its root when it moves to %s", landing => {
    const project = score("F major", [
      `E5/4 ${landing}/4`, "Bb4/4 A4/4", "G4/4 C4/4", "G3/4 F3/4",
    ], { labels: "DVII6/4 I/4" });

    if (landing === "F5") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "F");
    }
  });

  it.each(["B4", "E5"] as const)("a given V7/III still tests its own third when it moves to %s", landing => {
    const project = score("C major", [
      `D#5/4 ${landing}/4`, "A4/4 G4/4", "F#4/4 B3/4", "B2/4 E3/4",
    ], { labels: "V7/III/4 iii/4" });
    expect(project.chordTrack.regions[0].semantics?.interpretations[0].appliedTarget).toMatchObject({
      degree: 3, primaryFunction: "dominant", secondaryFunction: "tonic",
    });

    if (landing === "E5") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "E");
    }
    expect(resolutions(project, seventh)).toEqual([]);
  });

  it.each([
    ["DTIII", "given"],
    ["I7", "given"],
    ["DTIII", "blind writeback"],
  ] as const)("a sustained pitch from %s acquires its obligation upon entering V with %s chords", (first, entry) => {
    for (const landing of ["E5", "C5"]) {
      const input = score("C major", [
        `B4/2 ${landing}/4`, "G4/2 E4/4", "E4/4 D4/4 G3/4",
        first === "DTIII" ? "E3/4 G2/4 C3/4" : "C3/4 G2/4 C3/4",
      ], { labels: entry === "given" ? `${first}/4 V/4 I/4` : undefined, meter: "3/4" });
      const project = entry === "given" ? input : blindWriteback(input);
      expect(project.chordTrack.regions.find(chord => chord.startTick === project.ppq)).toMatchObject({
        identity: { root: { step: "G", alter: 0 }, structure: { quality: "major" } },
      });

      if (landing === "C5") {
        expect(resolutions(project, leading)).toEqual([]);
      } else {
        expectLeadingWarning(project, 1, 2, "C");
      }
    }
  });

  it.each(["G4", "Eb4"] as const)("keeps the key-based single-melody teaching check on D4 to %s", landing => {
    const project = blindWriteback(score("Eb major", [`D4/4 ${landing}/4`]));
    expect(project.chordTrack.regions).toEqual([]);

    if (landing === "Eb4") {
      expect(resolutions(project, leading)).toEqual([]);
    } else {
      expectLeadingWarning(project, 0, 1, "E♭");
    }
  });
});

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

function diminishedSeventhScore(example: (typeof cases)[number], soprano: string, tenor: string = example.parts[2]) {
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
    const resolved = inferred(diminishedSeventhScore(example, `${opening} ${example.resolved}/4`));
    expect(warnings(resolved)).toEqual([]);

    const unresolved = inferred(diminishedSeventhScore(example, `${opening} ${example.wrong}/4`));
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
    const project = diminishedSeventhScore(example, `${example.parts[0]} ${example.wrong}/4`);
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
    const project = inferred(diminishedSeventhScore(example, `${example.parts[0]} ${example.wrong}/4`, `${replacement}/4 A3/4`));
    expect(warnings(project)).toMatchObject([{
      tick: project.ppq,
      voiceIds: [example.inferredVoice],
      params: { targetTonic: example.inferredTonic },
    }]);
  });

  it("keeps the inferred target when its diminished seventh agrees with the written spelling", () => {
    const example = cases[0];
    const project = inferred(diminishedSeventhScore(example, "Db5/4 A4/4"));
    expect(warnings(project)).toMatchObject([{
      tick: project.ppq,
      voiceIds: [example.inferredVoice],
      params: { targetTonic: example.inferredTonic },
    }]);
  });

  it("drops the contradicted target without reading a local tonic across a manual phrase boundary", () => {
    const example = cases[0];
    const project = inferred(diminishedSeventhScore(example, `${example.parts[0]} ${example.wrong}/4`));
    project.structure.phraseBoundaries.push({
      id: "phrase-break", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(warnings(project)).toEqual([]);
  });
});

const rule = "resolution.leading-tone";
const bMajor = { tonic: { step: "B", alter: 0 }, mode: "major" };
const localDominantSeventhScore = `satb 1
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

function observedKeyAt(project: ProjectDocument, beats = 0) {
  const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  return writtenLocalLeadingToneKey(rules, rules.sliceAt(beats * project.ppq)!);
}

function identity(root: string, bass: string, quality: ChordQuality): ChordIdentity {
  return { root: parsePitchClass(root)!, bass: parsePitchClass(bass)!,
    structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

describe("E.1 collects the third of an independently observed local dominant", () => {
  it("uses the jointly written third and seventh in an unlabelled F-sharp dominant", () => {
    const project = compile(localDominantSeventhScore);
    expect(observedKeyAt(project)).toEqual(bMajor);
    expect(at(project)).toEqual([]);
  });

  it("uses the written inverted local dominant triad when its own leading tone resolves", () => {
    const project = compile(triad);
    expect(observedKeyAt(project)).toEqual({ tonic: { step: "F", alter: 1 }, mode: "minor" });
    expect(at(project)).toEqual([]);
  });

  it("accepts matching authored absolute identities even on a locked track", () => {
    const project = compile(localDominantSeventhScore, "D2/4 T/4");
    const [source, landing] = project.chordTrack.regions;
    source.identity = identity("F:1", "E:0", "dominant7");
    landing.identity = identity("B:0", "D:1", "major");
    source.semantics = undefined;
    landing.semantics = undefined;
    project.chordTrack.locked = true;
    expect(observedKeyAt(project)).toEqual(bMajor);
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
  ])("withholds local-tonic evidence when %s", (_name, text) => {
    const project = compile(text);
    expect(observedKeyAt(project)).toBeUndefined();
    // G-sharp is the written C-sharp triad's fifth.
    expect(at(project)).toEqual([]);
  });

  it("a tonic third in the wrong voice cannot witness a seventh resolution", () => {
    const elsewhere = held.replace("C#4/2 F#4/4", "C#4/2 D#4/4").replace("E3/2 D#3/4", "E3/2 F#2/4");
    const project = compile(elsewhere);
    expect(observedKeyAt(project, 1)).toBeUndefined();
    expect(at(project, 2)).toEqual([]);
  });

  it("respects a given dominant identity that conflicts with the written F-sharp seventh", () => {
    const project = compile(localDominantSeventhScore, "D2/4 r/4");
    expect(at(project)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
  });

  it("keeps a confirmed local target rather than replacing its mode from the sounding arrival", () => {
    const badThird = localDominantSeventhScore.replace("A#3/4 B3/4", "A#3/4 F#3/4");
    const project = compile(badThird, "D2/4 r/4");
    const source = project.chordTrack.regions[0];
    source.identity = identity("F:1", "E:0", "dominant7");
    const meaning = source.semantics!.interpretations[0];
    meaning.source = "confirmed";
    meaning.localKey = { tonic: parsePitchClass("B:0")!, mode: "minor" };
    expect(at(project)).toMatchObject([{ voiceIds: ["tenor"], params: { key: "B minor" } }]);
  });

  it("withholds local-tonic evidence when the landing is declared the next key's dominant", () => {
    const project = compile(localDominantSeventhScore, "r/4 D6/4");
    const landing = project.chordTrack.regions[0];
    landing.identity = identity("B:0", "D:1", "major");
    landing.semantics!.interpretations[0].localKey = { tonic: parsePitchClass("E:0")!, mode: "minor" };
    expect(observedKeyAt(project)).toBeUndefined();
    expect(at(project)).toEqual([]);
  });

  it("accepts the same landing when its confirmed home degree names the actual root", () => {
    const project = compile(localDominantSeventhScore, "r/4 D6/4");
    const landing = project.chordTrack.regions[0];
    landing.identity = identity("B:0", "D:1", "major");
    const meaning = landing.semantics!.interpretations[0];
    meaning.source = "confirmed";
    meaning.degree = 3;
    delete meaning.designation;
    delete meaning.localKey;
    expect(observedKeyAt(project)).toEqual(bMajor);
    expect(at(project)).toEqual([]);
  });

  it("cannot borrow a seventh marked as an ornament to justify a new key", () => {
    const project = compile(held);
    project.satbTracks.find(t => t.voice === "bass")!.notes[0].nonChordToneRole = "other";
    expect(observedKeyAt(project, 1)).toBeUndefined();
    expect(at(project, 2)).toEqual([]);
  });

  it("does not borrow a resolution across a manual phrase boundary", () => {
    const project = compile(localDominantSeventhScore);
    project.structure.phraseBoundaries.push({ id: "break", source: "manual", confidence: "certain", tick: project.ppq });
    expect(observedKeyAt(project)).toBeUndefined();
    expect(at(project)).toEqual([]);
  });

  it.each([[0.5], [1], [0.5, 1]])("survives a written-key reminder at %o", (...beats) => {
    const project = compile(localDominantSeventhScore);
    for (const beat of beats) {
      project.keyEvents.push({ ...project.keyEvents[0], id: "reminder-" + beat, tick: beat * project.ppq });
    }
    expect(observedKeyAt(project)).toEqual(bMajor);
    expect(at(project)).toEqual([]);
  });

  it("does not infer the opening across a real change of key that returns before the landing", () => {
    for (const key of [{ tonic: parsePitchClass("D:0")!, mode: "major" as const },
                       { tonic: parsePitchClass("G:0")!, mode: "minor" as const }]) {
      const project = compile(localDominantSeventhScore);
      project.keyEvents.push(
        { ...key, id: "new-key", tick: project.ppq / 4 },
        { ...project.keyEvents[0], id: "return", tick: project.ppq * 3 / 4 },
      );
      expect(validateProject(project)).toBe(true);
      expect(observedKeyAt(project)).toBeUndefined();
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
    expect(observedKeyAt(project, 1.25)).toBeUndefined();
  });

  it("cannot borrow the later dominant proof after an actual intervening pitch change", () => {
    const project = compile(localDominantSeventhScore.replace("F#4/4 B4/4", "F#4/16 F4/16 F#4/8 B4/4"));
    expect(observedKeyAt(project)).toBeUndefined();
    expect(observedKeyAt(project, 0.5)).toEqual(bMajor);
    expect(at(project, 0.25)).toEqual([]);
    expect(at(project)).toEqual([]);
  });
});

describe("Written role and attained tonic", () => {
  it("recognizes F-sharp as the root of the written local dominant triad", () => {
    const project = compile(localDominantSeventhScore.replace("E3/4 D#3/4", "F#3/4 D#3/4"));
    expect(observedKeyAt(project)).toEqual(bMajor);
    expect(at(project)).toEqual([]);
  });

  it("recognizes B as the seventh of the written local dominant", () => {
    const lowered = `satb 1
key C major
meter 2/4
bars 1..1 {
 S: | E#5/4 F#5/4 |
 A: | G#4/4 C#5/4 |
 T: | C#4/2 |
 B: | B2/4 A2/4 |
}`;
    const project = compile(lowered);
    expect(observedKeyAt(project)).toEqual({ tonic: { step: "F", alter: 1 }, mode: "minor" });
    expect(at(project)).toEqual([]);
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
    const resolved = compile(incomplete);
    expect(observedKeyAt(resolved)).toEqual({ tonic: { step: "C", alter: 1 }, mode: "minor" });
    expect(at(resolved)).toEqual([]);
    const wrongThird = compile(incomplete.replace("B#4/4 C#5/4", "B#4/4 E5/4"));
    expect(observedKeyAt(wrongThird)).toBeUndefined();
    // D-sharp in the bass is the fifth of G-sharp seventh.
    expect(at(wrongThird)).toEqual([]);
  });

  it("respects a mid-voicing chord declaration that conflicts with the witnessed harmony", () => {
    const conflict = compile(localDominantSeventhScore, "r/8 D2/8 r/4");
    expect(at(conflict)).toMatchObject([{ voiceIds: ["soprano"], params: { key: "G major" } }]);
    const same = compile(localDominantSeventhScore, "r/8 D2/8 r/4");
    const region = same.chordTrack.regions[0];
    region.identity = identity("F:1", "E:0", "dominant7");
    region.semantics = undefined;
    expect(observedKeyAt(same)).toEqual(bMajor);
    expect(at(same)).toEqual([]);
  });
});

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  successor?: string;
}

function heldDominant({
  soprano = "D5/8 C#5/8 D5/8",
  alto = "F4/4.",
  tenor = "B3/8 A#3/8 B3/8",
  bass = "G3/4.",
  harmony = "V7/8 r/8 V7/8",
  successor = "C4/4.",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 3/8
bars 1..2 {
 S: | ${soprano} | C5/4. |
 A: | ${alto} | E4/4. |
 T: | ${tenor} | ${successor} |
 B: | ${bass} | C3/4. |
 H: | ${harmony} | I/4. |
}`).project;
}

function accented({
  soprano = "D#5/8 C#5/8 C#5/4",
  tenor = "C#4/2",
  bass = "A#3/2",
  harmony = "r/8 V6/V/4.",
}: Example = {}) {
  return compileScoreText(`satb 1
key E major
meter 2/4
bars 1..2 {
 S: | C#5/2 | ${soprano} |
 A: | E#4/2 | F#4/2 |
 T: | C#4/2 | ${tenor} |
 B: | B3/2 | ${bass} |
 H: | r/2 | ${harmony} |
}`).project;
}

type Project = ReturnType<typeof heldDominant>;
function leadingNeighborWarnings(project: Project, voiceId: "tenor" | "soprano") {
  return checkHarmony(project).diagnostics
    .filter(item => item.ruleId === "resolution.leading-tone" && item.voiceIds.includes(voiceId))
    .map(({ tick, noteIds }) => ({ tick, noteIds }));
}

function accentedEvidence(project: Project) {
  const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const accent = rules.sliceAt(2 * project.ppq)!;
  const frame = leadingNeighborFrame(rules, "soprano", accent.notes.soprano!);
  return frame && accentedOrnamentOverWrittenTriad(rules, frame);
}

function addPhraseBoundary(project: Project, tick: number) {
  project.structure.phraseBoundaries.push({ id: "manual-boundary", tick, source: "manual", confidence: "certain" });
}

describe("E.1 书写导音与同一和声中的实际装饰", () => {
  it("同声部 B3–A#3–B3，且另一上声部也折返，在真正 C4 处才解决", () => {
    expect(leadingNeighborWarnings(heldDominant(), "tenor")).toEqual([]);
  });

  it("回到同一属七时允许局部调换序，改变实际落音仍须解决导音", () => {
    for (const succeeds of [true, false]) {
      const project = heldDominant({ successor: succeeds ? "C4/4." : "E4/4." });
      const [first, returning] = project.chordTrack.regions.map(region => region.semantics!.interpretations[0]);
      first.localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
      returning.localKey = { mode: "major", tonic: { alter: 0, step: "C" } };
      expect(leadingNeighborWarnings(project, "tenor").map(item => item.tick)).toEqual(succeeds ? [] : [1440]);
    }
  });

  it("返回后错到 E4 仍在真实和声后继发 warning", () => {
    expect(leadingNeighborWarnings(heldDominant({ successor: "E4/4." }), "tenor")).toEqual([
      { tick: 1440, noteIds: ["note-T-0", "note-T-1440"] },
    ]);
  });

  it("暂时触及主音 B3–C4–B3 也不能提前解除义务", () => {
    expect(leadingNeighborWarnings(heldDominant({ tenor: "B3/8 C4/8 B3/8", successor: "E4/4." }), "tenor")).toEqual([
      expect.objectContaining({ tick: 1440 }),
    ]);
  });

  it("伴奏实音不变而本调导音仅是 F 和弦上方辅助音时不建立义务", () => {
    const project = heldDominant({
      soprano: "A4/8 B4/8 A4/8", alto: "F4/4.", tenor: "C4/4.", bass: "F3/4.",
      harmony: "IV/8 r/8 IV/8",
    });
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([]);
  });

  it.each<[string, Example]>([
    ["折返错八度", { tenor: "B3/8 A#3/8 B4/8" }],
    ["实际下邻改为同音异名", { tenor: "B3/8 Bb3/8 B3/8" }],
    ["女高没有实际折返", { soprano: "D5/8 C#5/8 G4/8" }],
    ["只在离开前有一个和弦锚点", { harmony: "V7/8 r/4" }],
    ["持续低音改为同音重奏", { bass: "G3/8 G3/4" }],
    ["实际起奏是另一个已声明和弦", { harmony: "V7/8 II/8 V7/8" }],
  ])("%s 时保留原导音警告", (_label, options) => {
    expect(leadingNeighborWarnings(heldDominant(options), "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it.each([480, 720, 960])("手动句界 %s 阻止借用另一句的折返", tick => {
    const project = heldDominant();
    addPhraseBoundary(project, tick);
    expect(leadingNeighborWarnings(project, "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("实际调号事件打断原地装饰证据", () => {
    const project = heldDominant();
    project.keyEvents.push({ ...project.keyEvents[0], id: "next-key", tick: 720, tonic: { step: "G", alter: 0 } });
    expect(leadingNeighborWarnings(project, "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("强拍 D#5 虽是 E 的导音拼写，三部实奏已确保 F#6，C#5 实际重复", () => {
    const project = accented();
    expect(accentedEvidence(project)).toBe(true);
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([]);
  });

  it.each<[string, Example]>([
    ["中声部的冻结 B3 破坏独立三和弦", { tenor: "B3/2" }],
    ["只有回归音支持，不重复五音", { soprano: "D#5/8 C#5/4." }],
    ["明确写的是以 D# 为根音的小七和弦", { harmony: "vii43/8 V6/V/4." }],
    ["缺失回归和弦", { harmony: "r/2" }],
    ["三和弦低音在回归处才开始", { bass: "B3/8 A#3/4." }],
  ])("强拍处%s 时拒绝装饰解释", (_label, options) => {
    const project = accented(options);
    expect(accentedEvidence(project)).toBe(false);
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([]);
  });

  it("同名不同八度构不成强拍邻音的实际折返", () => {
    const project = accented({ soprano: "D#5/8 C#6/8 C#6/4" });
    expect(accentedEvidence(project)).toBeUndefined();
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([]);
  });

  it("同一个 D#5 确为本调导七根音时仍检查其解决", () => {
    const project = accented({ bass: "A3/8 A#3/4.", harmony: "viiø43/8 V6/V/4." });
    expect(accentedEvidence(project)).toBe(false);
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([expect.objectContaining({ tick: 2400 })]);
  });

  it("女高实际从结构导音离开时保留原警告", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | B4/4 E5/4 |
 A: | F4/4 G4/4 |
 T: | D4/4 C4/4 |
 B: | G2/4 C3/4 |
 H: | V7/4 I/4 |
}`).project;
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([expect.objectContaining({ tick: 960 })]);
  });

  it("强拍回归和五音复奏之间有手动句界", () => {
    const project = accented();
    addPhraseBoundary(project, 2640);
    expect(accentedEvidence(project)).toBe(false);
    expect(leadingNeighborWarnings(project, "soprano")).toEqual([]);
  });
});

describe("E.1 属低音持续时的同声部下邻音", () => {
  function lowerNeighbor(options: Example = {}) {
    return heldDominant({
      soprano: "D5/4.",
      tenor: "B3/8 A3/8 B3/8",
      bass: "G2/4.",
      ...options,
    });
  }

  it.each(["C4", "E4"])("真正离属处无标签时，仍按男高落到 %s 检查解决", landing => {
    const project = lowerNeighbor({ successor: `${landing}/4.` });
    const departure = project.ppq * 3 / 2;
    project.chordTrack.regions = project.chordTrack.regions.filter(region => region.startTick < departure);

    const reports = checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "resolution.leading-tone" && item.voiceIds.includes("tenor"));
    if (landing === "C4") {
      expect(reports).toHaveLength(0);
    } else {
      expect(reports).toMatchObject([{
        tick: departure,
        noteIds: ["note-T-0", `note-T-${departure}`],
        trace: expect.arrayContaining([
          { tick: project.ppq / 2, outcome: "continue", reason: "leading-tone-neighbor-return" },
          { tick: departure, outcome: "violate", reason: "leading-tone-moved-elsewhere" },
        ]),
      }]);
    }
  });

  it("同一低音、同一属七构成音恢复，但属三音由另一声部奏回时不算男高下邻返回", () => {
    const byTenor = lowerNeighbor();
    const byAlto = lowerNeighbor({
      alto: "F4/4 B3/8",
      tenor: "B3/8 A3/8 F3/8",
    });
    expect(leadingNeighborWarnings(byTenor, "tenor")).toEqual([]);
    expect(leadingNeighborWarnings(byAlto, "tenor")).toContainEqual({
      tick: byAlto.ppq / 2,
      noteIds: ["note-T-0", `note-T-${byAlto.ppq / 2}`],
    });
  });

  it("下邻与返回之间插入休止时保留下邻起点的告警", () => {
    const project = lowerNeighbor({ tenor: "B3/8 A3/16 r/16 B3/8" });
    expect(leadingNeighborWarnings(project, "tenor")).toContainEqual({
      tick: project.ppq / 2,
      noteIds: ["note-T-0", `note-T-${project.ppq / 2}`],
    });
  });

  it("下邻虽在原声部返回，句界仍禁止跨句延续", () => {
    const project = lowerNeighbor();
    addPhraseBoundary(project, project.ppq);
    expect(leadingNeighborWarnings(project, "tenor")).toContainEqual({
      tick: project.ppq / 2,
      noteIds: ["note-T-0", `note-T-${project.ppq / 2}`],
    });
  });
});

interface SequenceExample {
  initialSoprano?: string;
  thirdTenor?: string;
  lastSoprano?: string;
}

function example({
  initialSoprano = "F4/4 E4/4",
  thirdTenor = "E3/2",
  lastSoprano = "C4/2",
}: SequenceExample = {}) {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..5 {
 S: | ${initialSoprano} | E4/4 D4/4 | D4/4 C4/4 | A4/4 B3/4 | ${lastSoprano} |
 A: | D4/4 C4/4 | C4/4 B3/4 | B3/4 A3/4 | A3/4 G3/4 | G3/2 |
 T: | G3/2 | F3/2 | ${thirdTenor} | D3/2 | E3/2 |
 B: | B2/4 C3/4 | A2/4 B2/4 | G2/4 A2/4 | F2/4 G2/4 | C2/2 |
 H: | V65/4 I/4 | r/4 DVII/4 | iii65/4 vi/4 | ii65/4 V/4 | I/2 |
}
annotations {
 chord fourth at=2:1 duration=1/4 draft="{\\"degree\\":4,\\"degreeAlteration\\":0,\\"quality\\":\\"major7\\",\\"inversion\\":1,\\"source\\":\\"manual\\",\\"confidence\\":\\"certain\\"}"
}`).project;
}

function leadingWarnings(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics
    .filter(item => item.ruleId === "resolution.leading-tone")
    .map(({ tick, voiceIds }) => [tick, ...voiceIds]);
}

const seamWarnings = [[4 * PPQ, "bass"], [5 * PPQ, "alto"]];

function doubledLeadingTones(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.doubled-leading-tone");
}

describe("第 26 章调内模进中的导音义务", () => {
  it("放行第二组尾的旧义务，以及在第三组头同音重奏后才离开的声部", () => {
    expect(leadingWarnings(example())).toEqual([]);
  });

  it.each<[string, SequenceExample]>([
    ["前一组换了女高八度，只有其后两组能相配", { initialSoprano: "F5/4 E5/4" }],
    ["四声部音高相同但内声部起奏节奏不再相配", { thirdTenor: "E3/4 E3/4" }],
    ["其余三个声部仍移位，男高破坏第三组和弦", { thirdTenor: "G3/2" }],
  ])("%s 时仍报告两条导音", (_label, options) => {
    expect(leadingWarnings(example(options))).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("手动句界阻止借用之前一组的移位证据", () => {
    const project = example();
    project.structure.phraseBoundaries.push({
      id: "boundary", tick: 2 * PPQ, source: "manual", confidence: "certain",
    });
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("三组移位相同但实际最低声部与标注转位矛盾时保留导音警告", () => {
    const project = example();
    const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
    for (const note of tenor.notes) note.pitch.octave -= 2;
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("显式局部调阻止借用相同实音的移位证据", () => {
    const project = example();
    const meanings = project.chordTrack.regions.find(chord => chord.startTick === PPQ)?.semantics?.interpretations;
    expect(meanings?.length).toBe(1);
    const meaning = meanings![0];
    meaning.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("模进后真正的 V→I 女高 B3 错到 E4，仍报告其导音", () => {
    expect(leadingWarnings(example({ lastSoprano: "E4/2" }))).toEqual([[8 * PPQ, "soprano"]]);
  });
});

describe("调内模进复制的减三和弦重复根音", () => {
  const repeatedRoot = expect.objectContaining({ tick: 3 * PPQ, severity: "error", voiceIds: ["alto", "bass"] });

  it("四声部确实依次移位时可复制七级和弦的重复根音", () => {
    expect(doubledLeadingTones(example())).toEqual([]);
  });

  it.each<SequenceExample>([{ thirdTenor: "E3/4 E3/4" }, { initialSoprano: "F5/4 E5/4" }])(
    "有一组节奏或音区不匹配时仍报重复导音", variation => {
      expect(doubledLeadingTones(example(variation))).toContainEqual(repeatedRoot);
    },
  );

  it("穿过换句的音组不作为重复依据", () => {
    const project = example();
    project.structure.phraseBoundaries.push({ id: "cut", tick: 4 * PPQ, source: "manual", confidence: "certain" });
    expect(doubledLeadingTones(project)).toContainEqual(repeatedRoot);
  });

  it("属六和弦中的两个导音仍报错", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | D5/4 E5/4 |
 A: | B4/4 C5/4 |
 T: | G4/2 |
 B: | B2/4 C3/4 |
 H: | V6/4 I/4 |
}`).project;
    expect(doubledLeadingTones(project)).toContainEqual(expect.objectContaining({
      tick: 0, severity: "error", voiceIds: ["alto", "bass"],
    }));
  });
});

const fMinor = [
  "E4/2 | G4/4 F4/4",
  "C4/2 | C4/2",
  "Bb3/2 | Bb3/4 Ab3/4",
  "G2/2 | F2/2",
];
const eMajor = [
  "D#4/2 | F#4/4 E4/4",
  "B3/2 | B3/2",
  "A3/2 | G#3/2",
  "F#2/2 | E2/2",
];

function tonicNinthScore(parts: readonly string[], key: string, labels?: string, annotations?: string) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..2 {
${parts.map((part, index) => ` ${"SATB"[index]}: | ${part} |`).join("\n")}
${labels ? ` H: | ${labels} |` : ""}
}
${annotations ?? ""}`).project;
}

function sopranoWarnings(project: ProjectDocument) {
  const warnings = checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "resolution.leading-tone" && d.voiceIds.includes("soprano"));
  return warnings.map(({ tick, severity, params }) => ({ tick, severity, params }));
}

function changePart(parts: readonly string[], voice: number, part: string) {
  return parts.map((written, index) => index === voice ? part : written);
}

describe("E.1 over a harmonically prepared tonic 9–8", () => {
  it.each([
    ["F minor", fMinor, "V43/2 | i/2", "E4/2 | G4/4 Ab4/4"],
    ["E major", eMajor, "V43/2 | I/2", "D#4/2 | F#4/4 G#4/4"],
  ] as const)("the written 7–2–1 resolves in %s", (key, parts, labels, wrongSoprano) => {
    expect(sopranoWarnings(tonicNinthScore(parts, key))).toEqual([]);
    expect(sopranoWarnings(tonicNinthScore(parts, key, labels))).toEqual([]);
    expect(sopranoWarnings(tonicNinthScore(changePart(parts, 0, wrongSoprano), key, labels))).toMatchObject([{
      tick: 1920, severity: "warning",
    }]);
  });

  it("recognizes a single 9–8 in the same score when the seventh resolves with the bass", () => {
    expect(sopranoWarnings(tonicNinthScore(changePart(fMinor, 2, "Bb3/2 | Ab3/2"), "F minor"))).toEqual([]);
  });

  it("follows the actual ninth across a key reminder, label subdivisions and accompaniment reattacks", () => {
    const project = tonicNinthScore([
      fMinor[0], "C4/2 | C4/8 C4/8 C4/4", "Bb3/2 | Bb3/8 Bb3/8 Ab3/4", "G2/2 | F2/8 F2/8 F2/4",
    ], "F minor", "V43/2 | i/16 i/16 i/8 i/4");
    project.keyEvents.push({ ...project.keyEvents[0], id: "reminder", tick: 1920 + 720 });
    expect(sopranoWarnings(project)).toEqual([]);
  });

  it("rejects a real change of key even when the original key returns before the resolution", () => {
    const project = tonicNinthScore(fMinor, "F minor");
    const openingKey = project.keyEvents[0];
    project.keyEvents.push(
      { ...openingKey, id: "actual-change", tick: 2400, mode: "major" },
      { ...openingKey, id: "return", tick: 2640 },
    );
    expect(sopranoWarnings(project)).toMatchObject([{ tick: 1920, severity: "warning" }]);
  });

  it("rejects a manual phrase boundary under the ninth", () => {
    const project = tonicNinthScore(fMinor, "F minor");
    project.structure.phraseBoundaries.push({ id: "phrase-cut", tick: 2400, source: "manual", confidence: "certain" });
    expect(sopranoWarnings(project)).toMatchObject([{ tick: 1920, severity: "warning" }]);
  });

  it.each([
    ["a direct leap to a tonic member", 0, "E4/2 | C5/4 F4/4"],
    ["the ninth leaves without resolving", 0, "E4/2 | G4/4 Ab4/4"],
    ["the ninth has no fifth in the previous dominant for preparation", 3, "C3/2 | F2/2"],
    ["the bass changes before the ninth resolves", 3, "G2/2 | F2/4 C3/4"],
    ["the bass detours before returning for the resolution", 3, "G2/2 | F2/8 C3/8 F2/4"],
    ["the accompanying fourth never resolves to the tonic third", 2, "Bb3/2 | Bb3/4 C4/4"],
    ["another upper voice already has the tonic", 1, "C4/2 | F4/4 C4/4"],
    ["the apparent ninth is a second immediately above the bass", 3, "G2/2 | F4/2"],
  ] as const)("keeps the soprano warning for %s", (_name, voice, part) => {
    expect(sopranoWarnings(tonicNinthScore(changePart(fMinor, voice, part), "F minor"))).toMatchObject([{
      tick: 1920, severity: "warning", params: { leadingTone: "E", targetTonic: "F" },
    }]);
  });

  it("rejects a conflicting label in a subdivision under the held ninth", () => {
    expect(sopranoWarnings(tonicNinthScore(fMinor, "F minor", "V43/2 | i/8 iv/8 i/4"))).toMatchObject([{
      tick: 1920, severity: "warning", params: { targetTonic: "F" },
    }]);
  });

  it("respects the declared function of the same absolute tonic at the resolution", () => {
    const opening = 'chord source range=[1:1,2:1) symbol=V43 localKey="E major"';
    const landing = "chord landing range=[2:2,3:1)";
    const withLanding = (reading: string) => tonicNinthScore(eMajor, "A major", undefined, `annotations {
 ${opening}
 ${landing} ${reading}
}`);
    expect(sopranoWarnings(withLanding('symbol=I localKey="E major"'))).toEqual([]);
    const conflicting = withLanding("symbol=V");
    const warning = [{
      tick: 1920, severity: "warning", params: { key: "E major", targetTonic: "E" },
    }];
    expect(sopranoWarnings(conflicting)).toMatchObject(warning);

    conflicting.chordTrack.regions[1].semantics!.interpretations[0].source = "inferred";
    expect(sopranoWarnings(conflicting)).toEqual([]);
    conflicting.chordTrack.locked = true;
    expect(sopranoWarnings(conflicting)).toMatchObject(warning);
  });
});

function localDominantBassWarnings(parts: readonly string[]) {
  const score = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
${parts.map((part, i) => ` ${"SATB"[i]}: | ${part} |`).join("\n")}
}`).project;
  return checkHarmony(score).diagnostics.filter(d => d.ruleId === "resolution.leading-tone");
}

describe("未标注局部属七的目标", () => {
  it("由根音低音及完整目标三和弦确证 D7 到 G，三音和七音即便都走错也能检查 F♯", () => {
    // Neither the project leading tone B nor a correctly resolving F♯/C is needed at the source.
    const parts = ["F#4/4 D5/4", "C4/4 G4/4", "A3/4 B3/4", "D3/4 G2/4"];
    expect(localDominantBassWarnings(parts)).toMatchObject([{
      tick: 960, voiceIds: ["soprano"], params: { leadingTone: "F♯", targetTonic: "G" },
    }]);
    expect(localDominantBassWarnings(["F#4/4 G4/4", "C4/4 B3/4", "A3/4 D3/4", parts[3]])).toEqual([]);
  });

  it("调内 I 到 IV 的低音作四五度进行，不给主和弦三音建立离调导音义务", () => {
    expect(localDominantBassWarnings(["E4/4 A4/4", "C4/4 C4/4", "G3/4 F3/4", "C3/4 F2/4"])).toEqual([]);
  });
});
