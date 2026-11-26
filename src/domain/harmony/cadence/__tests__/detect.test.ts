import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../../chords";
import {
  createEmptyProject,
  normalizeProject,
  PPQ,
  validateProject,
  type ChordDraft,
  type NoteEvent,
} from "../../../project";
import { addCadenceAnnotation, deletePhraseBoundary } from "../../../editing";
import { createHarmonyRuleIndexes } from "../../rules/context/indexes";
import { spellMidi } from "../../../pitch";
import { buildHarmonyAnalysis } from "../../analysis";
import { detectCadences } from "../detect";
import { phraseInferenceFingerprint } from "../../phrase";
import { compileScoreText } from "../../../scoreText";

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

type CadenceTestBar = readonly [string, string, string, string, string];

function deceptiveProject(bars: readonly CadenceTestBar[]) {
  return compileScoreText([
    "satb 1",
    "key C major",
    "meter 4/4",
    `bars 1..${bars.length} {`,
    ...["S", "A", "T", "B", "H"].map((voice, index) =>
      `  ${voice}: | ${bars.map(bar => bar[index]).join(" | ")} |`),
    "}",
  ].join("\n")).project;
}

describe("阻碍终止", () => {
  const tonic: CadenceTestBar = ["C5/1", "G4/1", "E4/1", "C3/1", "I/1"];
  const subdominant: CadenceTestBar = ["A4/1", "F4/1", "C4/1", "F3/1", "IV/1"];
  const dominant: CadenceTestBar = ["D5/1", "B4/1", "G4/1", "G2/1", "V/1"];
  const submediant: CadenceTestBar = ["C5/1", "E4/1", "C4/1", "A2/1", "vi/1"];
  const prepared: CadenceTestBar = [
    "E5/4 D5/4 D5/2", "C5/4 B4/4 B4/2", "G4/4 G4/4 F4/2", "G2/4 G2/4 G2/2", "K46/4 V/4 V7/2",
  ];
  const interiorLanding: CadenceTestBar = [
    "C5/2 A4/2", "E4/2 F4/2", "C4/2 C4/2", "A2/2 F3/2", "vi/2 IV/2",
  ];
  const deceptive = (project: ReturnType<typeof deceptiveProject>) =>
    buildHarmonyAnalysis(project).cadenceCandidates.filter(cadence => cadence.kind === "deceptive");
  const withManualCut = (bars: readonly CadenceTestBar[]) => {
    const project = deceptiveProject(bars);
    project.structure.phraseBoundaries.push({
      id: "manual", tick: 8 * PPQ, source: "manual", confidence: "certain",
    });
    return project;
  };

  it("把句末五级属到六级标为正格阻碍终止", () => {
    expect(deceptive(deceptiveProject([dominant, submediant]))).toMatchObject([
      { form: "authentic", fromTick: 0, toTick: 8 * PPQ },
    ]);
  });

  it("句末范围包含终止四六和随后的连续属功能", () => {
    const analysis = buildHarmonyAnalysis(deceptiveProject([prepared, submediant]));
    expect(analysis.cadenceCandidates).toMatchObject([{
      kind: "deceptive", form: "authentic", fromTick: 0, toTick: 8 * PPQ,
      spanIds: analysis.harmonySpans.map(span => span.id),
      evidence: expect.arrayContaining([expect.objectContaining({ code: "cadential64-chain" })]),
    }]);
  });

  it("句末六级转位延长区间并保留原位六级的实际落点", () => {
    const revoiced: CadenceTestBar = [
      "C5/2 A4/2", "E4/2 E4/2", "C4/2 C4/2", "A2/2 C3/2", "vi/2 vi6/2",
    ];
    const analysis = buildHarmonyAnalysis(deceptiveProject([dominant, revoiced]));
    expect(analysis.cadenceCandidates).toMatchObject([{
      kind: "deceptive", form: "authentic", fromTick: 0, toTick: 8 * PPQ, observedLandingTick: 4 * PPQ,
      spanIds: analysis.harmonySpans.map(span => span.id),
    }]);
  });

  it("人工分句后保留终止四六准备的句内强拍阻碍和后续全终止", () => {
    const project = withManualCut([tonic, subdominant, tonic, prepared, interiorLanding, subdominant, dominant, tonic]);
    const analysis = buildHarmonyAnalysis(project);
    expect(analysis.cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "deceptive", form: "authentic", phraseId: analysis.phraseSegments[1].id,
      fromTick: 12 * PPQ, toTick: 18 * PPQ,
    }));
    expect(analysis.cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "full", toTick: 32 * PPQ,
    }));
  });

  it("人工乐句中后段的长原位属和强拍原位六级可独立支持阻碍终止", () => {
    const approach: CadenceTestBar = ["A4/2 D5/2", "F4/2 B4/2", "C4/2 G4/2", "F3/2 G2/2", "IV/2 V/2"];
    const project = withManualCut([tonic, subdominant, tonic, subdominant, approach, interiorLanding, dominant, tonic]);
    expect(deceptive(project)).toMatchObject([
      { form: "authentic", fromTick: 18 * PPQ, toTick: 22 * PPQ },
    ]);
  });

  it("人工乐句开头的普通属到六级保留为句内连接", () => {
    const project = withManualCut([tonic, subdominant, dominant, interiorLanding, tonic, subdominant, dominant, tonic]);
    expect(deceptive(project)).toEqual([]);
  });

  it("即使前有终止四六，弱拍一拍的六级也保留为句内连接", () => {
    const shortLanding: CadenceTestBar = [
      "D5/4 C5/4 A4/2", "B4/4 E4/4 F4/2", "G4/4 C4/4 C4/2", "G2/4 A2/4 F3/2", "V/4 vi/4 IV/2",
    ];
    const project = withManualCut([tonic, subdominant, tonic, prepared, shortLanding, subdominant, dominant, tonic]);
    expect(deceptive(project)).toEqual([]);
  });
});

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
    expect(cadenceInD(undefined, undefined, "E4/4 A4/4")).toMatchObject([{ completion: "imperfect" }]);
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

  it("把同一主音的实际再奏计作补充前的旋律延长", () => {
    const score = plagalEnding.replace("C5/1", "C5/4 C5/4 C5/2");
    expect(buildHarmonyAnalysis(compileScoreText(score).project).cadenceCandidates)
      .toMatchObject([{ kind: "full", toTick: 5 * PPQ }, { kind: "supplementary" }]);
  });

  it.each(["passing64", "pedal64"] as const)("句界上的 %s 不能用作正格终止的主和弦", (role) => {
    const score = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | D5/4 C5/4 |
  A: | G4/4 G4/4 |
  T: | B3/4 E4/4 |
  B: | G2/4 G2/4 |
  H: | D/4 T64/4 |
}`;
    const project = compileScoreText(score).project;
    project.chordTrack.regions[1].semantics!.cadenceRole = role;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toEqual([]);
  });

  it("终止随真实谱尾定位，未标和声的后续音符不能算作尾部静音", () => {
    const project = baseProject();
    project.lengthTicks += PPQ;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([{ kind: "full", toTick: 2 * PPQ }]);
    project.satbTracks[0].notes.push(note("extra", 2 * PPQ, 60));
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toEqual([]);
  });

  it("同一属和弦在已确定句界两侧重新起音时，前句可以止于属", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | C5/4 D5/4 | D5/4 C5/4 |
  A: | G4/4 G4/4 | G4/4 G4/4 |
  T: | E4/4 B3/4 | B3/4 E4/4 |
  B: | C3/4 G2/4 | G2/4 C3/4 |
  H: | T/4 D/4 | D/4 T/4 |
}`).project;
    project.structure.phraseBoundaries = [{ id: "split", tick: 2 * PPQ, source: "manual", confidence: "certain" }];
    const regions = project.chordTrack.regions;
    regions[1].durationTicks += regions[2].durationTicks;
    regions.splice(2, 1);
    const analysis = buildHarmonyAnalysis(project);
    expect(analysis.cadenceCandidates).toMatchObject([
      { kind: "half", fromTick: PPQ, toTick: 2 * PPQ },
      { kind: "full", fromTick: 2 * PPQ, toTick: 4 * PPQ },
    ]);
    const views = createHarmonyRuleIndexes(analysis).cadenceViews;
    expect(views.map(view => [view.spans[0].firstSlice.tick, view.spans.at(-1)?.lastSlice.endTick]))
      .toEqual([[PPQ, 2 * PPQ], [2 * PPQ, 4 * PPQ]]);
    const [half] = analysis.cadenceCandidates;
    const annotation = {
      id: "accepted-half", fromTick: half.fromTick, toTick: half.toTick, kind: half.kind, form: half.form,
      phraseId: half.phraseId, source: "accepted-candidate" as const, confidence: "probable" as const, locked: false,
    };
    expect(addCadenceAnnotation(project, { ...annotation, toTick: half.toTick - 1 }).error).toBeTruthy();
    const added = addCadenceAnnotation(project, annotation);
    expect(added.error).toBeUndefined();
    const reopened = JSON.parse(JSON.stringify(normalizeProject(added.project)));
    expect(validateProject(reopened)).toBe(true);
    expect(reopened.chordTrack.cadenceAnnotations[0]).toMatchObject({ ...annotation, stale: false });
    const afterDeletion = deletePhraseBoundary(added.project, "split").project;
    expect(afterDeletion.chordTrack.cadenceAnnotations[0].stale).toBe(true);
    expect(validateProject(afterDeletion)).toBe(true);
  });

  it("持续属和弦中的人工句界保留前后句的实际覆盖，不制造新的起奏", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | D5/2 | D5/4 C5/4 |
  A: | G4/2 | G4/4 G4/4 |
  T: | B3/2 | B3/4 E4/4 |
  B: | G2/2 | G2/4 C3/4 |
  H: | D/2 | D/4 T/4 |
}`).project;
    const split = PPQ * 1.5;
    const initial = buildHarmonyAnalysis(project);
    expect(initial.cadenceCandidates).toMatchObject([{ kind: "full", fromTick: 0, toTick: 4 * PPQ }]);
    project.structure.phraseBoundaries = [{ id: "split", tick: split, source: "manual", confidence: "certain" }];
    const analysis = buildHarmonyAnalysis(project);
    expect(analysis.cadenceCandidates).toMatchObject([
      { kind: "half", fromTick: 0, toTick: split },
      { kind: "full", fromTick: split, toTick: 4 * PPQ },
    ]);
    expect(analysis.slices).toEqual(initial.slices);
    const [half, full] = createHarmonyRuleIndexes(analysis).cadenceViews;
    expect(half.spans.at(-1)?.lastSlice).toMatchObject({ tick: 0, endTick: split });
    expect(full.spans[0].firstSlice).toMatchObject({ tick: split, endTick: 2 * PPQ, attackVoiceIds: [] });
    const annotated = addCadenceAnnotation(project, {
      id: "accepted", phraseId: half.phraseId, fromTick: 0, toTick: split,
      kind: "half", source: "accepted-candidate", confidence: "certain", locked: false,
    });
    expect(annotated.error).toBeUndefined();
    const saved = createHarmonyRuleIndexes(buildHarmonyAnalysis(annotated.project)).cadenceViews
      .find(view => view.annotation?.id === "accepted");
    expect(saved?.spans.at(-1)?.lastSlice.endTick).toBe(split);
    project.structure.phraseBoundaries = [{ id: "estimate", tick: split, source: "inferred",
      confidence: "probable", inferenceFingerprint: phraseInferenceFingerprint(project) }];
    const estimated = buildHarmonyAnalysis(project);
    expect(estimated.phraseSegments).toHaveLength(2);
    expect(estimated.cadenceCandidates.some(item => item.kind === "half")).toBe(false);
    project.structure.phraseBoundaries = [{ id: "old", tick: split, source: "inferred", confidence: "certain", stale: true }];
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toEqual(initial.cadenceCandidates);
  });

  it("连续属色彩及其终止四六进入范围，强拍延长的下属可作为完全终止的起点", () => {
    const score = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | C5/2 B4/4 | C5/2. |
  A: | F4/2 F4/4 | E4/2. |
  T: | A3/2 D4/4 | G3/2. |
  B: | F2/2 G2/4 | C3/2. |
  H: | S/2 D7/4 | T/2. |
}`;
    const analyze = (text: string) => buildHarmonyAnalysis(compileScoreText(text).project).cadenceCandidates;
    expect(analyze(score)).toMatchObject([{ kind: "full", fromTick: 0, evidence: expect.arrayContaining([
      expect.objectContaining({ code: "predominant-to-dominant" }),
    ]) }]);
    expect(analyze(score.replace("S/2 D7/4", "K46/4 D/4 D7/4").replace("F2/2", "G2/2")))
      .toMatchObject([{ kind: "full", fromTick: 0, spanIds: expect.arrayContaining([expect.any(String)]) }]);
  });

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

  it.each([
    ["iii6", "E5", "G4", "B3", "G2"],
    ["iii7", "D5", "G4", "B3", "E3"],
    ["K46", "E5", "G4", "C4", "G2"],
  ])("模进停在 %s 时，属功能色彩不能单独构成半终止", (symbol, s, a, t, b) => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | F5/4 E5/4 ${s}/4 |
  A: | A4/4 C5/4 ${a}/4 |
  T: | D4/4 G4/4 ${t}/4 |
  B: | D3/4 C3/4 ${b}/4 |
  H: | ii/4 T/4 ${symbol}/4 |
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates.some(item => item.kind === "half")).toBe(false);
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

const briefDominantMotion = `satb 1
key C major
meter 2/4
bars 1..4 {
  S: | E5/4 D5/4 | C5/4 A4/4 | G4/4 A4/4 | E5/2 |
  A: | C5/4 G4/4 | G4/4 F4/4 | E4/4 F4/4 | C5/2 |
  T: | G4/4 B3/4 | E4/4 C4/4 | C4/4 C4/4 | G4/2 |
  B: | C3/4 G2/4 | C3/4 F2/4 | C3/4 F2/4 | C3/2 |
  H: | T/4 D/4 | T/4 S/4 | T/4 S/4 | T/2 |
}`;

const tonicAfterDominant = `satb 1
key C major
meter 4/4
bars 1..6 {
  S: | D5/1 | C5/1 | A4/1 | G4/1 | A4/1 | E5/1 |
  A: | G4/1 | G4/1 | F4/1 | E4/1 | F4/1 | C5/1 |
  T: | B3/1 | E4/1 | C4/1 | C4/1 | C4/1 | G4/1 |
  B: | G2/1 | C3/1 | F2/1 | C3/1 | F2/1 | C3/1 |
  H: | D/1 | T/1 | S/1 | T/1 | S/1 | T/1 |
}`;

const twoPhrases = `annotations {
  phrase first range=[1:1,3:1)
  phrase second range=[3:1,7:1)
}`;

describe("独立不完满变格终止", () => {
  it("识别带三音旋律位置的句末原位变格，句中的短属主连接保留为进行", () => {
    const project = compileScoreText(briefDominantMotion).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 5 * PPQ, toTick: 8 * PPQ, confidence: "probable" },
    ]);
  });

  it("识别女高音落主音的第一转位下属到原位小主", () => {
    const project = compileScoreText(`satb 1
key G minor
meter 4/4
bars 1..2 {
  S: | C5/1 | G4/1 |
  A: | G4/1 | D4/1 |
  T: | C4/1 | Bb3/1 |
  B: | Eb3/1 | G2/1 |
  H: | s6/1 | t/1 |
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 0, toTick: 8 * PPQ },
    ]);
  });

  it("同一句的长补充尾部保留补充变格", () => {
    const project = compileScoreText(tonicAfterDominant).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it("前句已检测到正格收束时，跨句长尾的最后一次变格仍属补充", () => {
    const project = compileScoreText(`${briefDominantMotion}
annotations {
  phrase first range=[1:1,2:2)
  phrase tail range=[2:2,5:1)
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: 3 * PPQ },
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });

  it("前句正格后出现新和声材料，后句可以独立变格收束", () => {
    const score = tonicAfterDominant
      .replace("G4/1 | G4/1 | F4/1", "G4/1 | G4/1 | E4/1")
      .replace("G2/1 | C3/1 | F2/1", "G2/1 | C3/1 | A2/1")
      .replace("D/1 | T/1 | S/1", "D/1 | T/1 | vi/1");
    const project = compileScoreText(`${score}\n${twoPhrases}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: 8 * PPQ },
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it.each([
    ["四声部休止", 6, tonicAfterDominant
      .replace("D5/1 | C5/1", "D5/1 | C5/2 r/2")
      .replace("G4/1 | G4/1", "G4/1 | G4/2 r/2")
      .replace("B3/1 | E4/1", "B3/1 | E4/2 r/2")
      .replace("G2/1 | C3/1", "G2/1 | C3/2 r/2")],
    ["和声覆盖断裂", 8, tonicAfterDominant.replace("D/1 | T/1 | S/1", "D/1 | T/1 | r/2 S/2")],
  ])("到达%s时停止追溯补充段", (_reason, release, score) => {
    const project = compileScoreText(`${score}\n${twoPhrases}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: release * PPQ },
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it("前段参考和已写回终止都不影响检测，含同一范围的已写回标注", () => {
    const expected = buildHarmonyAnalysis(compileScoreText(briefDominantMotion).project).cadenceCandidates;
    const annotated = compileScoreText(`${briefDominantMotion}
annotations {
  phrase whole range=[1:1,5:1)
  cadence early phrase=whole range=[1:2,2:2) kind=full form=authentic completion=perfect
  cadence savedTail phrase=whole range=[3:2,5:1) kind=supplementary form=plagal
}`).project;
    const referenced = compileScoreText(`${briefDominantMotion}
reference complete=cadence {
  phrase whole range=[1:1,5:1)
  cadence early phrase=whole range=[1:2,2:2) kind=full form=authentic completion=perfect
}`);
    expect(annotated.chordTrack.cadenceAnnotations).toHaveLength(2);
    expect(referenced.reference.cadences).toHaveLength(1);
    expect(buildHarmonyAnalysis(annotated).cadenceCandidates).toEqual(expected);
    expect(buildHarmonyAnalysis(referenced.project).cadenceCandidates).toEqual(expected);
  });

  it("保持上声共同音时拒绝独立收束标签", () => {
    const project = compileScoreText(briefDominantMotion.replace("G4/4 A4/4 | E5/2", "G4/4 C5/4 | C5/2")).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });

  it("下属跨度末拍低音提前落主时拒绝独立收束标签", () => {
    const project = compileScoreText(briefDominantMotion.replace("C3/4 F2/4 | C3/2", "C3/4 F2/8 C3/8 | C3/2")).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });
});
