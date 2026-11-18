import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../chords";
import { createEmptyProject, PPQ, type ChordDraft, type NoteEvent } from "../../project";
import { spellMidi } from "../../pitch";
import { buildHarmonyAnalysis } from "../analysis";
import { detectCadences } from "./detect";
import { phraseInferenceFingerprint } from "../phrase";
import { compileScoreText } from "../../scoreText";

function note(id: string, startTick: number, midi: number): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch: spellMidi(midi),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function chord(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  startTick: number,
  draft: Omit<ChordDraft, "source" | "confidence">,
) {
  project.chordTrack.regions.push(
    createChordRegion(
      project,
      startTick,
      PPQ,
      { ...draft, source: "manual", confidence: "certain" },
      id,
    ),
  );
}

function baseProject() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.satbTracks.find((track) => track.id === "bass")!.notes = [
    note("bass-dominant", 0, 43),
    note("bass-tonic", PPQ, 36),
  ];
  project.satbTracks.find((track) => track.id === "soprano")!.notes = [
    note("soprano-dominant", 0, 62),
    note("soprano-tonic", PPQ, 60),
  ];
  chord(project, "dominant", 0, {
    degree: 5,
    degreeAlteration: 0,
    quality: "major",
    inversion: 0,
  });
  chord(project, "tonic", PPQ, {
    degree: 1,
    degreeAlteration: 0,
    quality: "major",
    inversion: 0,
  });
  return project;
}

describe("终止候选检测", () => {
  function cadenceInD(source = 'symbol=V localKey="D major"', bass = "A2/4 D3/4", soprano = "E4/4 D4/4") {
    const score = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | ${soprano} |
  A: | C#4/4 A3/4 |
  T: | A3/4 F#3/4 |
  B: | ${bass} |
}
annotations {
  chord d at=1:1 duration=1/4 ${source}
  chord t at=1:2 duration=1/4 symbol=I localKey="D major"
}`;
    return buildHarmonyAnalysis(compileScoreText(score).project).cadenceCandidates;
  }

  it("用后调的低音五到一与旋律主音判断正格终止和完满度", () => {
    expect(cadenceInD()).toMatchObject([{ kind: "full", form: "authentic", completion: "perfect" }]);
    expect(cadenceInD(undefined, undefined, "E4/4 F#4/4")).toMatchObject([{ completion: "imperfect" }]);
  });

  it("后调必须有同调的属主解决和实写低音支持", () => {
    expect(cadenceInD('symbol=V localKey="C major"')).toEqual([]);
    expect(cadenceInD('symbol=V/V localKey="D major"')).toEqual([]);
    expect(cadenceInD(undefined, "C#3/4 D3/4")).toEqual([]);
  });

  it.each([
    ["D6", "T", "B2", "C3", "imperfect"],
    ["D", "T6", "G2", "E3", "imperfect"],
    ["D6", "T", "G2", "C3", undefined],
  ] as const)("根据实际低音判定转位正格终止 %s–%s，低音 %s–%s", (dominant, tonic, bass1, bass2, expected) => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
  S: | D5/1 | C5/1 |
  A: | G4/1 | G4/1 |
  T: | B3/1 | E4/1 |
  B: | ${bass1}/1 | ${bass2}/1 |
  H: | ${dominant}/1 | ${tonic}/1 |
}`).project;
    const full = buildHarmonyAnalysis(project).cadenceCandidates.find(item => item.kind === "full");
    expect(full?.form).toBe("authentic");
    expect(full?.completion).toBe(expected);
    expect(full?.confidence).toBe("probable");
  });

  it("只在乐句末端识别 D -> T 为全终止", () => {
    const project = baseProject();
    const analysis = buildHarmonyAnalysis(project);
    const candidates = detectCadences(analysis);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "full",
      form: "authentic",
      completion: "perfect",
      fromTick: 0,
      toTick: PPQ * 2,
      confidence: "certain",
    });
  });

  const plagalEnding = `satb 1
key C major
meter 4/4
bars 1..2 {
  S: | D5/1 | C5/1 |
  A: | G4/1 | G4/4 A4/4 G4/2 |
  T: | B3/1 | E4/4 F4/4 E4/2 |
  B: | G2/1 | C3/4 F2/4 C3/2 |
  H: | D/1 | T/4 S/4 T/2 |
}`;

  it("保留同一句内正格收束与后续补充变格的两个落点", () => {
    const pedalEnding = plagalEnding.replace("F2/4", "C3/4").replace(" S/4", " S64/4");
    for (const score of [plagalEnding, pedalEnding]) {
      const analysis = buildHarmonyAnalysis(compileScoreText(score).project);
      expect(analysis.cadenceCandidates).toMatchObject([
        { kind: "full", form: "authentic", completion: "perfect", fromTick: 0, toTick: 5 * PPQ, confidence: "probable" },
        { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
      ]);
      const [authentic, supplementary] = analysis.cadenceCandidates;
      expect(authentic.phraseId).toBe(supplementary.phraseId);
      expect(authentic.evidence.some(item => item.code === "metric-support")).toBe(true);
      expect(authentic.evidence.some(item => item.code === "phrase-boundary")).toBe(false);
    }
  });

  it("先前主和弦占满一小节时，补充段允许女高音重新活动", () => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..4 {
  S: | D5/2. | C5/2. | A4/2. | C5/2. |
  A: | G4/2. | G4/2. | F4/2. | G4/2. |
  T: | B3/2. | E4/2. | C4/2. | E4/2. |
  B: | G2/2. | C3/2. | F2/2. | C3/2. |
  H: | D/2. | T/2. | S/2. | T/2. |
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", toTick: 6 * PPQ },
      { kind: "supplementary", fromTick: 6 * PPQ, toTick: 12 * PPQ },
    ]);
  });

  it.each([
    ["前次落点短、女高音继续活动", plagalEnding.replace("C5/1", "C5/4 A4/4 C5/2")],
    ["持续的女高音落在三音", plagalEnding.replace("C5/1", "E5/1")],
    ["前一属和弦的实际低音不是五级", plagalEnding.replace("G2/1", "B2/1")],
    ["落主后与补充段之间有空档", plagalEnding.replace("T/4 S/4", "T/8 r/8 S/4")],
    ["普通句末下属到主", plagalEnding.replace("D/1 | T/4", "T/1 | T/4")],
  ])("%s 时不多报内部正格终止", (_, score) => {
    expect(buildHarmonyAnalysis(compileScoreText(score).project).cadenceCandidates)
      .toMatchObject([{ kind: "supplementary" }]);
  });

  it("弱拍落主或另起一句时，不向前拼接正格终止", () => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | D5/4 C5/2. |
  A: | G4/4 G4/4 A4/4 G4/4 |
  T: | B3/4 E4/4 F4/4 E4/4 |
  B: | G2/4 C3/4 F2/4 C3/4 |
  H: | D/4 T/4 S/4 T/4 |
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([{ kind: "supplementary" }]);

    const split = compileScoreText(plagalEnding).project;
    split.structure.phraseBoundaries = [{ id: "split", tick: 4 * PPQ, source: "manual", confidence: "certain" }];
    expect(buildHarmonyAnalysis(split).cadenceCandidates).toMatchObject([
      { kind: "half" },
      { kind: "supplementary" },
    ]);
  });

  it("乐句中间的 D -> T 不产生终止候选", () => {
    const project = baseProject();
    project.structure.phraseBoundaries = [
      {
        id: "middle",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];
    const analysis = buildHarmonyAnalysis(project);

    const candidates = detectCadences(analysis);
    expect(candidates.some((candidate) => candidate.kind === "full")).toBe(
      false,
    );
    expect(candidates.find((candidate) => candidate.kind === "half")).toMatchObject({
      form: "authentic",
      toTick: PPQ,
    });
  });

  it("保留导七落点原有的半终止候选，正格标记仅用于五级属和弦", () => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | F4/1 |
  A: | D4/1 |
  T: | A3/1 |
  B: | B2/1 |
  H: | DVII7/1 |
}`).project;
    const half = buildHarmonyAnalysis(project).cadenceCandidates.find(item => item.kind === "half");
    expect(half).toBeDefined();
    expect(half?.form).toBeUndefined();
  });

  it("乐句置信度会限制终止置信度", () => {
    const project = baseProject();
    project.structure.phraseBoundaries = [
      {
        id: "probable",
        tick: PPQ,
        source: "inferred",
        confidence: "probable",
        inferenceFingerprint: phraseInferenceFingerprint(project),
      },
    ];
    const analysis = buildHarmonyAnalysis(project);

    const candidates = detectCadences(analysis);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.confidence !== "certain")).toBe(
      true,
    );
  });
});
