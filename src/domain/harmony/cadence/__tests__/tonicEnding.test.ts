import { describe, expect, it } from "vitest";
import { PPQ, migrateProject, normalizeProject } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";
import { inferHarmony } from "../../inference";
import { addCadenceAnnotation, addPhraseBoundary } from "../../../editing";
import { createHarmonyRuleContext } from "../../rules/context/createRuleContext";
import { annotationFromCadenceCandidate } from "../model";
import { phraseInferenceFingerprint } from "../../phrase";

const withBassOctave = `satb 1
key D minor
meter 4/4
bars 1..2 {
  S: | F4/2. A4/4 | D4/2 r/2 |
  A: | D4/2. C#4/4 | D4/8 G#3/8 A3/4 r/2 |
  T: | A3/2. G3/4 | F3/8 E3/8 F3/4 r/2 |
  B: | D3/2. A2/4 | D3/4 D2/4 r/2 |
  H: | i/2. V7/4 | i/8 r/8 i/4 r/2 |
}`;

const contraryPassing = `satb 1
key E minor
meter 3/4
bars 1..2 {
  S: | B4/8 C5/8 B4/4. A4/8 | G4/8 F#4/8 E4/2 |
  A: | E4/2 D#4/4 | B3/2. |
  T: | G3/8 A3/8 G3/4 F#3/4 | E3/8 F#3/8 G3/2 |
  B: | B2/2 B2/4 | E3/2. |
  H: | I64/2 V/8 V7/8 | i/8 r/8 i/2 |
}`;

function findCadence(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(candidate =>
    candidate.evidence.some(evidence => evidence.code === "closing-tonic-decoration"));
}

describe("a decorated final tonic after a written authentic arrival", () => {
  it.each([
    [withBassOctave, 3 * PPQ, 4 * PPQ, 6 * PPQ, "perfect"],
    [contraryPassing, 2 * PPQ, 3 * PPQ, 6 * PPQ, "imperfect"],
  ] as const)("keeps the actual first tonic as the landing and the final joint release", (text, _from, arrival, release, completion) => {
    const { project } = compileScoreText(text);
    expect(findCadence(project)).toMatchObject({
      kind: "full", form: "authentic", completion, observedLandingTick: arrival, toTick: release,
    });
  });

  it.each([
    ["bass reattacks inside the decoration", "D3/4 D2/4", "D3/8 D3/8 D2/4"],
    ["final bass is a different chord member", "D3/4 D2/4", "D3/4 F2/4"],
    ["unchanged soprano is reattacked on return", "D4/2 r/2", "D4/4 D4/4 r/2"],
    ["decoration is left by a leap", "G#3/8 A3/4", "E3/8 A3/4"],
    ["literal gap is labeled as an independent chord", "i/8 r/8 i/4", "i/8 V7/V/8 i/4"],
    ["final tenor releases early", "E3/8 F3/4 r/2", "E3/8 F3/8 r/8 r/2"],
    ["dominant loses its written seventh", "A3/2. G3/4", "A3/2. E3/4"],
  ] as const)("does not connect through an ornament when %s", (_name, before, after) => {
    expect(withBassOctave).toContain(before);
    const { project } = compileScoreText(withBassOctave.replace(before, after));
    expect(findCadence(project)).toBeUndefined();
  });

  it.each([
    [contraryPassing, "soprano", 3.5, "passing", true],
    [contraryPassing, "tenor", 3.5, "passing", true],
    [contraryPassing, "soprano", 3.5, "neighbor", false],
    [withBassOctave, "tenor", 4.5, "neighbor", true],
    [withBassOctave, "tenor", 4.5, "passing", false],
    [withBassOctave, "alto", 4.5, "passing", false],
    [contraryPassing, "soprano", 3.5, "suspension", false],
  ] as const)("matches the declared ornament to its written entry and exit", (text, voice, beat, role, accepted) => {
    const { project } = compileScoreText(text);
    const track = project.satbTracks.find(part => part.voice === voice)!;
    track.notes.find(note => note.startTick === beat * PPQ)!.nonChordToneRole = role;
    expect(Boolean(findCadence(project))).toBe(accepted);
  });

  it("honors a phrase break at the returned tonic, or a cut inside a ringing dominant", () => {
    for (const tick of [5 * PPQ, 3.5 * PPQ]) {
      const { project } = compileScoreText(withBassOctave);
      project.structure.phraseBoundaries = [{ id: "split", tick, source: "manual", confidence: "certain" }];
      expect(findCadence(project)).toBeUndefined();
    }
  });

  it.each([4.5, 4.75, 5.5])("recognizes the same sounding decoration across a key restatement at %s", beat => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push({ ...project.keyEvents[0], id: "restate", tick: beat * PPQ });
    expect(findCadence(project)?.observedLandingTick).toBe(4 * PPQ);
  });

  it("rejects a brief change of key even when the original key returns at the tonic", () => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push(
      { id: "change", tick: 4.75 * PPQ, tonic: { step: "F", alter: 0 }, mode: "major" },
      { ...project.keyEvents[0], id: "return", tick: 5 * PPQ },
    );
    expect(findCadence(project)).toBeUndefined();
  });

  it("respects an actual change of key during the decoration", () => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push({ id: "new-key", tick: 4.5 * PPQ, tonic: { step: "F", alter: 0 }, mode: "major" });
    expect(findCadence(project)).toBeUndefined();
  });

  it("does not attach new music at the same release to the earlier tonic", () => {
    const { project } = compileScoreText(withBassOctave);
    const at = 6 * PPQ;
    for (const track of project.satbTracks) {
      const next = track.notes.at(-1)!;
      track.notes.push({ ...next, id: "restart-" + next.id, startTick: at, durationTicks: PPQ });
    }
    project.structure.phraseBoundaries = [{
      id: "split", tick: at, confidence: "certain", source: "manual",
    }];
    expect(findCadence(project)).toBeUndefined();
  });
});

const ppq = 960;
const landingTick = 4 * ppq;

interface Fixture {
  target?: readonly string[];
  preparation?: readonly string[];
  source?: readonly string[];
  weakLanding?: boolean;
  annotations?: boolean;
  key?: "Eb major" | "Eb minor";
}

function score({
  target = ["Eb5/4 r/2.", "G4/4 r/2.", "r/1", "Eb3/4 r/2."],
  preparation = ["Eb5/4", "C5/4", "Ab3/4", "Ab2/4"],
  source = ["D5/4", "Ab4/4", "F4/4", "Bb2/4"],
  weakLanding = false, annotations = false, key = "Eb major",
}: Fixture = {}) {
  const lines = ["satb 1", "key " + key, weakLanding ? "meter 3/4" : "meter 4/4", "bars 1..2 {"];
  for (const [i, voice] of ["S", "A", "T", "B"].entries()) {
    if (weakLanding) {
      const attack = i === 2 ? "r/4" : target[i].split(" ")[0];
      lines.push(voice + ": | " + preparation[i] + " r/4 " + source[i] + " | r/4 " + attack + " r/4 |");
    } else {
      const gap = source[i].endsWith("/2") ? " | " : " r/4 | ";
      lines.push(voice + ": | " + preparation[i] + " r/4 " + source[i] + gap + target[i] + " |");
    }
  }
  if (annotations) lines.push("H: | IV/4 r/4 V7/4 r/4 | I/4 r/2. |");
  return compileScoreText([...lines, "}"].join("\n")).project;
}

function analyzeSparseTonic(raw: ReturnType<typeof score>) {
  const chords = inferChords(raw);
  const { project } = applyHarmonyInference(raw, { chordInference: chords }, { mode: "replace-unlocked" });
  const analysis = buildHarmonyAnalysis(project);
  const recovered = analysis.cadenceCandidates.find(c => c.evidence.some(e => e.code === "detached-sparse-tonic"));
  return { project, analysis, chords, recovered };
}

describe("A sparse closing tonic after two detached harmonies", () => {
  it.each([
    ["G4/4 r/2.", "r/1"],
    ["r/1", "G3/4 r/2."],
  ])("recognizes the two roots and whichever inner track actually contains the third", (alto, tenor) => {
    const { project, analysis, chords, recovered } = analyzeSparseTonic(score({
      target: ["Eb5/4 r/2.", alto, tenor, "Eb3/4 r/2."],
    }));
    expect(recovered).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 2 * ppq, unharmonizedLandingTick: landingTick, toTick: 5 * ppq,
    });
    expect(chords.regions.find(r => r.fromTick <= landingTick && landingTick < r.toTick)?.status).toBe("unclassified");
    const arrival = analysis.slices.find(slice => slice.tick === landingTick)!;
    expect(Object.keys(arrival.notes)).toHaveLength(3);
    expect(arrival.chord).toBeUndefined();
    expect(recovered?.chordIds).toEqual(project.chordTrack.regions
      .filter(c => c.startTick === 2 * ppq).map(c => c.id));
    expect(checkHarmony(project).diagnostics.filter(d => d.ruleId.startsWith("cadence."))).toEqual([]);
  });

  it("reads the actual minor third in the established minor key", () => {
    const { recovered, analysis } = analyzeSparseTonic(score({
      key: "Eb minor", preparation: ["Eb5/4", "Cb5/4", "Ab3/4", "Ab2/4"],
      target: ["Eb5/4 r/2.", "Gb4/4 r/2.", "r/1", "Eb3/4 r/2."],
    }));
    expect(recovered?.unharmonizedLandingTick).toBe(landingTick);
    expect(analysis.slices.find(s => s.tick === landingTick)?.chord).toBeUndefined();
  });

  it.each<readonly [string, Fixture]>([
    ["root and third in only two written voices", { target: ["r/1", "G4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["missing the written third", { target: ["Eb5/4 r/2.", "Bb4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["the other mode's written third", { target: ["Eb5/4 r/2.", "Gb4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["competing bass instead of the root", { target: ["Eb5/4 r/2.", "G4/4 r/2.", "r/1", "C3/4 r/2."] }],
    ["a weak arrival in an otherwise identical rhythm", { weakLanding: true }],
    ["independent solo music after a complete rest", { target: ["Eb5/4 r/4 F5/2", "G4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["an early release of the third", { target: ["Eb5/4 r/2.", "G4/8 r/8 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["a sounding note in the shared rest", { source: ["D5/2", "Ab4/4", "F4/4", "Bb2/4"] }],
    ["a dominant without its written seventh", { source: ["D5/4", "Bb4/4", "F4/4", "Bb2/4"] }],
  ])("preserves the undecided landing with %s", (_label, fixture) => {
    expect(analyzeSparseTonic(score(fixture)).recovered).toBeUndefined();
  });

  it.each([ppq, 2 * ppq, 3 * ppq, landingTick])("honors a phrase boundary at %i", tick => {
    const project = score();
    project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick }];
    expect(analyzeSparseTonic(project).recovered).toBeUndefined();
  });

  it("leaves the original given-chord route in charge when a terminal chord exists", () => {
    const given = buildHarmonyAnalysis(score({ annotations: true })).cadenceCandidates;
    expect(given).toHaveLength(1);
    expect(given[0]).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 2 * ppq, toTick: 5 * ppq,
    });
    expect(given[0].unharmonizedLandingTick).toBeUndefined();
    expect(given[0].evidence.some(e => e.code === "detached-dominant-to-tonic")).toBe(true);
  });

  it("rejects a same-tonic key event introduced during the shared rest", () => {
    const project = score();
    project.keyEvents.push({ ...project.keyEvents[0], id: "key-reset", tick: 7 * ppq / 2 });
    expect(analyzeSparseTonic(project).recovered).toBeUndefined();
  });
});

const octaveEndingPpq = 960;
const landing = 4 * octaveEndingPpq;

function ending(voices = ["G5/2", "G4/2", "G3/2", "G2/2"], key = "G major",
  dominant = ["F#5", "D5", "A3", "D3"], onsets = "") {
  const initial = ["G5", key.endsWith("minor") ? "Bb4" : "B4", "D4", "G2"];
  return compileScoreText([
    "satb 1", "key " + key, "meter 2/4", onsets, "bars 1..3 {",
    ...["S", "A", "T", "B"].map((voice, i) =>
      voice + ": | " + initial[i] + "/2 | " + dominant[i] + "/2 | " + voices[i] + " |"),
    "}",
  ].join("\n")).project;
}

function analyzeOctaveEnding(raw: ReturnType<typeof ending>) {
  const chordInference = inferChords(raw);
  const { project } = applyHarmonyInference(raw, { chordInference }, { mode: "replace-unlocked" });
  const analysis = buildHarmonyAnalysis(project);
  return { chordInference, project, analysis, end: analysis.cadenceCandidates.find(candidate =>
    candidate.evidence.some(evidence => evidence.code === "octave-tonic-ending")) };
}

describe("An unharmonized tonic closing after a complete dominant triad", () => {
  it.each(["G major", "G minor"])("reads simultaneous tonic octaves at the real ending in %s", key => {
    const raw = ending(["G5/4 r/4", "G4/4 r/4", "G3/4 r/4", "G3/4 r/4"], key);
    const { end, analysis, project, chordInference } = analyzeOctaveEnding(raw);
    expect(end).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 2 * octaveEndingPpq, unharmonizedLandingTick: landing, toTick: 5 * octaveEndingPpq,
    });
    expect(analysis.slices.find(slice => slice.tick === landing)?.chord).toBeUndefined();
    expect(chordInference.regions.find(region => region.fromTick === landing)?.status).toBe("unclassified");
    expect(project.chordTrack.regions.every(chord => chord.startTick + chord.durationTicks <= landing)).toBe(true);
    expect(checkHarmony(project).diagnostics.map(d => d.ruleId)).not.toContain("cadence.bass-formula");
    expect(checkHarmony(project).diagnostics.map(d => d.ruleId)).not.toContain("cadence.unstable-ending");
    expect(end?.chordIds).toEqual(project.chordTrack.regions.filter(chord => chord.startTick === 2 * octaveEndingPpq).map(chord => chord.id));
  });

  it.each([
    ["one voice", ["G5/2", "r/2", "r/2", "r/2"]],
    ["only the octave pair", ["G5/2", "r/2", "r/2", "G3/2"]],
    ["all four in exact unison", ["G4/2", "G4/2", "G4/2", "G4/2"]],
    ["four voices in only two registers", ["G5/2", "G5/2", "G3/2", "G3/2"]],
    ["the dominant pedal continues", ["G5/2", "G4/2", "G3/2", "D3/2"]],
    ["a spare fifth", ["G5/2", "G4/2", "D4/2", "G3/2"]],
    ["a brief arrival below one written beat", ["G5/8 r/4.", "G4/8 r/4.", "G3/8 r/4.", "G3/8 r/4."]],
    ["a ragged release", ["G5/2", "G4/4 r/4", "G3/2", "G3/2"]],
    ["a staggered entrance", ["G5/2", "r/8 G4/4.", "G3/2", "G3/2"]],
    ["a G octave in the middle of new motion", ["G5/4 A5/4", "G4/4 F#4/4", "G3/4 D4/4", "G3/4 D3/4"]],
  ])("does not infer this ending with %s", (_description, voices) => {
    expect(analyzeOctaveEnding(ending(voices)).end).toBeUndefined();
  });

  it("requires a contiguous actual dominant and stepwise leading-tone resolution", () => {
    const closing = ["G5/2", "G4/2", "G3/2", "G3/2"];
    for (const source of [
      ["F#5", "D5", "F#4", "D3"], // written V with the fifth absent
      ["F#5", "C5", "A3", "D3"], // actual V7, seventh needs its own resolution
      ["F#5", "D5", "A3", "A2"], // V in the wrong inversion
      ["D5", "F#4", "A3", "D3"], // soprano jumps; this branch requires an audible lead
      ["F#5", "D5", "A3", "D4"], // bass reaches G3, but crosses the actual tenor
    ]) {
      const negative = analyzeOctaveEnding(ending(closing, "G major", source));
      expect(negative.end).toBeUndefined();
    }
    const interrupted = ending(closing);
    for (const track of interrupted.satbTracks) {
      const note = track.notes.find(n => n.startTick === 2 * octaveEndingPpq)!;
      note.durationTicks -= octaveEndingPpq / 2;
    }
    expect(analyzeOctaveEnding(interrupted).end).toBeUndefined();
  });

  it("bounds an open excerpt by the sounding quarter without needing a rest or meter change", () => {
    const raw = ending(["G5/4 r/4", "G4/4 r/4", "G3/4 r/4", "G3/4 r/4"]);
    raw.lengthTicks = landing + octaveEndingPpq;
    expect(raw.meterEvents).toHaveLength(1);
    const { end } = analyzeOctaveEnding(raw);
    expect(end).toMatchObject({ confidence: "probable", unharmonizedLandingTick: landing, toTick: raw.lengthTicks });
  });

  it("does not recover an arrival across a manual phrase boundary", () => {
    const raw = ending(["G5/2", "G4/2", "G3/2", "G3/2"]);
    raw.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick: landing }];
    expect(analyzeOctaveEnding(raw).end).toBeUndefined();
  });

  it("needs a major dominant even when the modal seventh has the right bass formula", () => {
    const { end } = analyzeOctaveEnding(ending(["G5/2", "G4/2", "G3/2", "G3/2"], "G major", ["F5", "C5", "A3", "D3"]));
    expect(end).toBeUndefined();
  });

  it("keeps a new key and a user annotation authoritative", () => {
    const closing = ["G5/2", "G4/2", "G3/2", "G3/2"];
    expect(analyzeOctaveEnding(ending(closing, "G major", undefined, "at 3:1 key G minor")).end).toBeUndefined();
    expect(analyzeOctaveEnding(ending(closing, "C major")).end).toBeUndefined();

    const applied = analyzeOctaveEnding(ending(closing)).project;
    const written = compileScoreText([
      "satb 1", "key G major", "meter 2/4", "bars 1..3 {", "S: empty", "A: empty", "T: empty", "B: empty", "H: | I/2 | V/2 | I/2 |", "}",
    ].join("\n")).project.chordTrack.regions;
    applied.chordTrack.regions = [...applied.chordTrack.regions, ...written.filter(r => r.startTick === landing)];
    const full = buildHarmonyAnalysis(applied).cadenceCandidates.filter(c => c.kind === "full");
    expect(full).toHaveLength(1);
    expect(full[0].unharmonizedLandingTick).toBeUndefined();
  });

  it.each(["Bb4", "B4"])("keeps the explicit minor or raised third %s out of the octave-only branch", third => {
    const { end, project } = analyzeOctaveEnding(ending(["G5/2", third + "/2", "G3/2", "G3/2"], "G minor"));
    expect(end).toBeUndefined();
    expect(project.satbTracks[1].notes.at(-1)?.pitch.alter).toBe(third === "Bb4" ? -1 : 0);
  });
});

const parts = `bars 1..2 {
 S: | G4/2. D5/4 | C5/1 |
 A: | C4/2. B3/4 | C4/8 Bb3/8 Ab3/4 G3/2 |
 T: | Eb3/2. F3/4 | Eb3/8 E3/8 F3/4 Eb3/2 |
 B: | C3/2. G2/4 | C3/1 |
}`;

const labeled = `annotations {
chord d range=[1:4,2:1) symbol=D7 localKey="C minor"
chord t1 range=[2:1,2:1+1/2) symbol=t localKey="C minor"
chord a range=[2:1+1/2,2:2) symbol=V7/IV localKey="C minor"
chord s range=[2:2,2:3) symbol=iv64 localKey="C minor"
chord t2 range=[2:3,3:1) symbol=t localKey="C minor"
}`;

function analyzePedalEnding(notes = parts, chords = labeled, key = "Eb major", manualBoundary?: number) {
  const { project } = compileScoreText(`satb 1\nkey ${key}\nmeter 4/4\n${notes}\n${chords}`);
  if (manualBoundary !== undefined) {
    project.structure.phraseBoundaries.push({ id: "manual", tick: manualBoundary, source: "manual", confidence: "certain" });
  }
  const analysis = buildHarmonyAnalysis(project);
  return { project, analysis, recovered: analysis.cadenceCandidates.find(c =>
    c.evidence.some(e => e.code === "closing-tonic-pedal")) };
}

describe("正格落主后的持续主音", () => {
  it("以第一处实际落主判定完满，持续主音共同释放才是尾界", () => {
    const { project, analysis, recovered } = analyzePedalEnding();
    expect(recovered).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 3 * PPQ, toTick: 8 * PPQ, observedLandingTick: 4 * PPQ,
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "closing-tonic-pedal", refs: expect.arrayContaining(["note-B-3840", "note-S-3840"]),
      })]),
    });
    expect(analysis.harmonySpans.slice(-5).map(span => span.regionIds[0]))
      .toEqual(project.chordTrack.regions.map(chord => chord.id));
    expect(analysis.cadenceCandidates.filter(c => c.toTick === 8 * PPQ)).toHaveLength(1);
  });

  it("持续音收在一同休止之前，保留实际释放点", () => {
    const stopped = parts.replace("C5/1", "C5/2. r/4").replace("| C3/1", "| C3/2. r/4")
      .replace("G3/2", "G3/4 r/4").replace("Eb3/2 |", "Eb3/4 r/4 |");
    expect(analyzePedalEnding(stopped, labeled.replace("2:3,3:1", "2:3,2:4")).recovered)
      .toMatchObject({ fromTick: 3 * PPQ, toTick: 7 * PPQ, completion: "perfect" });
  });

  it.each([
    ["低音同高重奏", parts.replace("| C3/1", "| C3/2 C3/2")],
    ["低音下换八度", parts.replace("| C3/1", "| C3/2 C2/2")],
    ["女高同高重奏", parts.replace("C5/1", "C5/2 C5/2")],
    ["实际最高声部变成内声部", parts.replace("C5/1", "C4/1").replace("Ab3/4", "Ab4/4")],
    ["局部属七的三音等音误拼", parts.replace("E3/8", "Fb3/8")],
    ["主调属七七音只换声部解决", parts.replace("B3/4 | C4/8", "B3/4 | Eb4/8").replace("F3/4 | Eb3/8", "F3/4 | C4/8")],
    ["副属七音向上而另一部代替预期落点", parts.replace("Ab3/4", "F4/4").replace("F3/4 Eb3/2", "Ab3/4 Eb3/2")],
    ["末主和弦不完整", parts.replace("G3/2", "C4/2")],
    ["延展中内声实际休止", parts.replace("F3/4 Eb3/2", "r/8 F3/8 Eb3/2")],
  ])("%s 时不能接长终止", (_name, score) => {
    expect(analyzePedalEnding(score).recovered).toBeUndefined();
  });

  it("下属占两拍时不按短内声扩展接长终止", () => {
    const prolonged = parts.replace("Ab3/4 G3/2", "Ab3/2 G3/4").replace("F3/4 Eb3/2", "F3/2 Eb3/4");
    const longerChords = labeled.replace("2:2,2:3", "2:2,2:4").replace("2:3,3:1", "2:4,3:1");
    expect(analyzePedalEnding(prolonged, longerChords).recovered).toBeUndefined();
  });

  it.each([4.5, 5, 6])("显式句界从第 %s 拍切断持续音取证", beat => {
    expect(analyzePedalEnding(parts, labeled, "Eb major", beat * PPQ).recovered).toBeUndefined();
  });

  it("冲突的应用目标不能借两个外声部持续取证", () => {
    expect(analyzePedalEnding(parts, labeled.replace("symbol=V7/IV", "symbol=V7/V")).recovered).toBeUndefined();
  });

  it("同一落点原已独立检出的补充终止仍沿用现有分类", () => {
    const { analysis, recovered } = analyzePedalEnding(parts, labeled.replaceAll(' localKey="C minor"', ""), "C minor");
    expect(recovered).toBeUndefined();
    expect(analysis.cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "supplementary", toTick: 8 * PPQ,
    }));
  });

  it("从正常盲推写回的不同局部小调获得同一结果", () => {
    const text = `satb 1
key G major
meter 4/4
bars 1..3 {
 S: | B4/1 | C5/4 D5/4 C5/4 B4/4 | A4/1 |
 A: | G4/1 | G#4/4 A4/4 A4/4 G#4/4 | A4/8 G4/8 F4/4 E4/2 |
 T: | D4/1 | F4/4 E4/4 F4/4 D4/4 | C4/8 C#4/8 D4/4 C4/2 |
 B: | G3/1 | B2/4 C3/4 D3/4 E3/4 | A2/1 |
}`;
    const { project } = compileScoreText(text);
    const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" });
    const recovered = buildHarmonyAnalysis(applied.project).cadenceCandidates.find(c =>
      c.evidence.some(e => e.code === "closing-tonic-pedal"));
    expect(recovered).toMatchObject({ kind: "full", completion: "perfect", toTick: 12 * PPQ });
  });
});

const major = `satb 1
key D major
meter 4/4
bars 1..3 {
  S: | r/2. E5/4 | D5/1~ | D5/1 |
  A: | r/2. C#4/4 | D4/4 C4/4 B3/4 Bb3/4 | A3/1 |
  T: | r/2. G3/4 | F#3/4 A3/4 G3/4 E3/4 | F#3/1 |
  B: | r/2. A2/4 | D3/1~ | D3/1 |
  H: | r/2. V7/4 | I/4 r/4 IV64/4 r/4 | I/1 |
}`;

const minor = `satb 1
key Eb major
meter 6/8
bars 1..3 {
  S: | r/t2400 D5/8 | C5/2 r/4 | Bb4/2. |
  A: | r/t2400 B3/8 | C4/4 Ab3/8 G3/8 r/4 | G4/2. |
  T: | r/t2400 F3/8 | Eb3/4 F3/8 Eb3/8 r/4 | Eb4/2. |
  B: | r/t2400 G2/8 | C3/2 r/4 | Eb3/2. |
}
annotations {
  chord dominant range=[1:6,2:1) symbol=V7 localKey="C minor"
  chord arrival range=[2:1,2:3) symbol=t localKey="C minor"
  chord auxiliary range=[2:3,2:4) symbol=iv64 localKey="C minor"
  chord terminal range=[2:4,2:5) symbol=t localKey="C minor"
  chord new-phrase range=[3:1,4:1) symbol=I
  phrase first range=[1:1,2:5)
}`;

function analyzeRevoicingEnding(text: string, barrier?: number) {
  const { project } = compileScoreText(text);
  if (barrier !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "confirmed-split", tick: barrier, source: "manual", confidence: "certain",
    });
  }
  return inspect(project);
}

function inspect(project: ReturnType<typeof compileScoreText>["project"]) {
  const analysis = buildHarmonyAnalysis(project);
  const reading = analysis.cadenceCandidates.find(candidate =>
    candidate.evidence.some(item => item.code === "closing-tonic-revoicing"));
  return { analysis, reading };
}

describe("属七落主后的外声持续与内声重配", () => {
  it("跨小节持续的外声保留实际落主，内声未标的行进可穿过", () => {
    const { analysis, reading } = analyzeRevoicingEnding(major);
    const arrival = analysis.harmonySpans.find(span => span.fromTick === 4 * PPQ)!;
    expect(reading).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 3 * PPQ, toTick: 12 * PPQ,
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "closing-tonic-revoicing", refs: expect.arrayContaining([arrival.id, "note-S-3840", "note-B-3840"]),
      })]),
    });
  });

  it("确认、重开和规则都使用首次落主，失效后取消省五音豁免", () => {
    const { project } = compileScoreText(major);
    const { analysis, reading } = inspect(project);
    const arrival = 4 * PPQ;
    const unconfirmed = createHarmonyRuleContext(analysis).cadenceAt(arrival);
    expect(unconfirmed?.landingSpan?.firstSlice.tick).toBe(arrival);
    expect(unconfirmed?.precedingSpan?.firstSlice.tick).toBe(3 * PPQ);
    expect(unconfirmed?.spans.at(-1)?.firstSlice.tick).toBe(8 * PPQ);

    const accepted = addCadenceAnnotation(project, annotationFromCadenceCandidate(reading!, "held"));
    expect(accepted.error).toBeUndefined();
    const reopened = migrateProject(JSON.parse(JSON.stringify(normalizeProject(accepted.project))))!;
    const view = (input: typeof project) =>
      createHarmonyRuleContext(buildHarmonyAnalysis(input)).cadences({ id: "held" }).first();
    expect(view(reopened)?.landingSpan?.firstSlice.tick).toBe(arrival);
    expect(view(reopened)?.precedingSpan?.firstSlice.tick).toBe(3 * PPQ);
    const missingFifth = (input: typeof project) => checkHarmony(input).diagnostics
      .some(d => d.ruleId === "chord.incomplete-members" && d.tick === arrival);
    expect(missingFifth(project)).toBe(false);
    expect(missingFifth(reopened)).toBe(false);
    expect(checkHarmony(reopened).diagnostics.filter(d => d.ruleId.startsWith("cadence."))).toEqual([]);

    const edited = addPhraseBoundary(reopened, arrival).project;
    expect(view(edited)?.annotation?.stale).toBe(true);
    expect(view(edited)?.precedingSpan).toBeUndefined();
    expect(view(edited)?.landingSpan).toBeUndefined();
    expect(missingFifth(edited)).toBe(true);
  });

  it("局部小调尾部在曲中实际齐收和休止，跨不过去连下句", () => {
    expect(analyzeRevoicingEnding(minor).reading).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 2.5 * PPQ, toTick: 5 * PPQ,
    });
  });

  it("明确半终止和后句起奏分开保留", () => {
    const { analysis, reading } = analyzeRevoicingEnding(major, 4 * PPQ);
    expect(reading).toBeUndefined();
    expect(analysis.cadenceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "half", toTick: 4 * PPQ }),
    ]));
  });

  it.each([
    ["同一低音重新起奏", major.replace("D3/1~ | D3/1", "D3/1 | D3/1")],
    ["顶部跨八度重新起奏", major.replace("D5/1~ | D5/1", "D5/1 | D6/1")],
    ["上声旋律提前放开", major.replace("D5/1~ | D5/1", "D5/1~ | D5/2 r/2")],
    ["内声出现别的实际休止", major.replace("C4/4 B3/4", "r/4 B3/4")],
    ["无标间隔实际另有完整三和弦", major.replace("C4/4 B3/4", "A3/4 B3/4")
      .replace("F#3/4 A3/4 G3/4", "F#3/4 F#3/4 G3/4")],
    ["属七的七音向上", major.replace("G3/4 | F#3/4", "G3/4 | F#4/4")],
    ["最后低音没有共同释放", major.replace("D3/1~ | D3/1", "D3/1~ | D3/2 r/2")],
    ["下属用途来自前后同属而不是一次主音持续", major.replace("IV64", "V64")],
  ])("%s，不能用局部重配补出正格", (_name, text) => {
    expect(analyzeRevoicingEnding(text).reading).toBeUndefined();
  });
});

function declareSameKey(project: ReturnType<typeof compileScoreText>["project"], tick: number) {
  project.keyEvents.push({ ...project.keyEvents[0], id: "same-written-key", tick });
}

describe("主音重配的结构证据范围", () => {
  it("手工句首可取新奏属七，不把句首之前已经发声的属七当新起点", () => {
    expect(analyzeRevoicingEnding(major, 3 * PPQ).reading?.fromTick).toBe(3 * PPQ);
    expect(analyzeRevoicingEnding(major, 3 * PPQ + PPQ / 8).reading).toBeUndefined();
  });

  it.each([44, 192])("速度 %i 不改变单拍与复拍的谱面证据", bpm => {
    for (const [score, release] of [[major, 12 * PPQ], [minor, 5 * PPQ]] as const) {
      const { project } = compileScoreText(score);
      project.tempoEvents[0].bpm = bpm;
      expect(inspect(project).reading?.toTick).toBe(release);
    }
  });

  it.each([
    ["4/4", major, PPQ],
    ["6/8", minor, PPQ / 2],
  ] as const)("%s 的保存推断句界须有一记谱拍静默", (_meter, score, denominatorBeat) => {
    for (const [gap, inferred, manual] of [
      [0, false, false], [1, false, true], [denominatorBeat - 1, false, true], [denominatorBeat, true, true],
    ] as const) {
      const { project } = compileScoreText(score);
      const release = score === major ? project.lengthTicks : 5 * PPQ;
      project.lengthTicks = release + 2 * PPQ;
      for (const track of project.satbTracks) {
        track.notes = track.notes.filter(note => note.startTick < release);
        const last = track.notes.at(-1)!;
        track.notes.push({ ...last, id: `restart-${last.id}`, startTick: release + gap, durationTicks: PPQ });
      }
      project.chordTrack.regions = project.chordTrack.regions.filter(region => region.startTick < release);
      project.structure.phraseBoundaries = [{
        id: "saved-cut", tick: release, source: "inferred", confidence: "probable", stale: false,
        inferenceFingerprint: phraseInferenceFingerprint(project),
      }];
      let replay = inspect(project);
      expect(replay.analysis.phraseSegments[0].endBoundary?.source).toBe("inferred");
      expect(Boolean(replay.reading)).toBe(inferred);
      project.structure.phraseBoundaries = [{ id: "confirmed-cut", tick: release, source: "manual", confidence: "certain" }];
      replay = inspect(project);
      expect(Boolean(replay.reading)).toBe(manual);
    }
  });

  it("同一调号事件内取证，重申调号处确有新奏属七则从该处开始", () => {
    const heldDominant = major.replaceAll("r/2.", "r/2")
      .replace("E5/4", "E5/2").replace("C#4/4", "C#4/2").replace("G3/4 |", "G3/2 |")
      .replace("A2/4", "A2/2").replace("V7/4", "V7/2");
    const { project: redeclaredMidChord } = compileScoreText(heldDominant);
    declareSameKey(redeclaredMidChord, 3 * PPQ);
    expect(inspect(redeclaredMidChord).reading).toBeUndefined();

    const withApproach = major.replace("S: | r/2.", "S: | r/2 E5/4")
      .replace("A: | r/2.", "A: | r/2 C#4/4").replace("T: | r/2.", "T: | r/2 A3/4")
      .replace("B: | r/2.", "B: | r/2 A2/4").replace("H: | r/2.", "H: | r/2 V/4");
    const { project: redeclaredAtAttack } = compileScoreText(withApproach);
    expect(inspect(redeclaredAtAttack).reading?.fromTick).toBe(2 * PPQ);
    declareSameKey(redeclaredAtAttack, 3 * PPQ);
    expect(inspect(redeclaredAtAttack).reading?.fromTick).toBe(3 * PPQ);
  });

  it("低于落主的第三拍可作重配，另一小节同强度首拍不足以证明同一次收束", () => {
    expect(analyzeRevoicingEnding(major).reading?.toTick).toBe(12 * PPQ);
    const onNextDownbeat = major.replace("D4/4 C4/4 B3/4 Bb3/4 | A3/1", "D4/2. C4/4 | B3/4 Bb3/4 A3/2")
      .replace("F#3/4 A3/4 G3/4 E3/4 | F#3/1", "F#3/2. A3/4 | G3/4 E3/4 F#3/2")
      .replace("I/4 r/4 IV64/4 r/4 | I/1", "I/2. r/4 | IV64/4 r/4 I/2");
    expect(analyzeRevoicingEnding(onNextDownbeat).reading).toBeUndefined();
  });
});
