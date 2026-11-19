import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  PPQ,
  type NoteEvent,
  type ProjectDocument,
} from "../../project";
import {
  analyzePhrases,
  inferPhrases,
  isCurrentPhraseBoundary,
  phraseInferenceFingerprint,
  phraseAtTick,
} from "./index";
import { compileScoreText } from "../../scoreText";

function note(id: string, startTick: number, durationTicks: number): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: { step: "C", alter: 0, octave: 4 },
    velocity: 80,
    locked: false,
    spellingSource: "manual",
  };
}

function setIntervals(
  project: ProjectDocument,
  intervals: readonly (readonly [number, number])[],
) {
  project.satbTracks.forEach((track) => {
    track.notes = intervals.map(([startTick, endTick], index) =>
      note(track.id + "-" + index, startTick, endTick - startTick));
  });
}

function passingSixFourProject() {
  const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..8 {
  S: | E5/2. | F5/2. | C5/2. | D5/2 B4/4 | C5/4 D5/4 C5/4 | A4/2. | D5/2. | C5/2. |
  A: | G4/2. | A4/2. | E4/2. | G4/2 D4/4 | G4/2. | F4/2. | G4/2. | G4/2. |
  T: | C4/2. | C4/2. | G3/2. | B3/2 G3/4 | C4/4 B3/4 E4/4 | C4/2. | B3/2. | E4/2. |
  B: | C3/2. | F3/2. | C3/2. | G2/2 F2/4 | E3/4 D3/4 C3/4 | F3/2. | G2/2. | C3/2. |
  H: | T/2. | S/2. | T/2. | D/2 D2/4 | T6/4 D64/4 T/4 | S/2. | D/2. | T/2. |
}`).project;
  const passing = project.chordTrack.regions.find(chord => chord.startTick === 13 * PPQ)!;
  passing.semantics!.cadenceRole = "passing64";
  return project;
}

function auxiliarySixFourProject(pedal = "E3/2.") {
  const project = compileScoreText(`satb 1
key A minor
meter 4/4
bars 1..8 {
  S: | C5/1 | A4/1 | C5/1 | E5/1 | A4/1 | F5/1 | B4/1 | A4/1 |
  A: | A4/1 | F4/1 | A4/1 | B4/4 C5/4 B4/2 | E4/1 | A4/1 | G#4/1 | E4/1 |
  T: | E4/1 | D4/1 | E4/1 | G#4/4 A4/4 G#4/2 | A3/1 | C4/1 | E4/1 | C4/1 |
  B: | A2/1 | D3/1 | A2/1 | ${pedal} D3/4 | C3/1 | F3/1 | E3/1 | A2/1 |
  H: | t/1 | s/1 | t/1 | D/4 t64/4 D/4 D2/4 | t6/1 | VI/1 | D/1 | t/1 |
}`).project;
  const auxiliary = project.chordTrack.regions.find(chord => chord.startTick === 13 * PPQ)!;
  auxiliary.semantics!.cadenceRole = "pedal64";
  return project;
}

describe("乐句分析", () => {
  it("将工程首尾作为确定边界并生成单个乐句", () => {
    const result = analyzePhrases(createEmptyProject());

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      PPQ * 4 * 16,
    ]);
    expect(result.segments).toMatchObject([{
      fromTick: 0,
      toTick: PPQ * 4 * 16,
      source: "inferred",
      confidence: "certain",
    }]);
    expect(result.candidates).toEqual([]);
    expect(result.template.kind).toBe("single");
  });

  it("按人工边界生成相邻且不重叠的乐句", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [{
      id: "phrase-middle",
      tick: PPQ * 4,
      source: "manual",
      confidence: "certain",
    }];

    const result = analyzePhrases(project);

    expect(result.segments.map((segment) => [segment.fromTick, segment.toTick])).toEqual([
      [0, PPQ * 4],
      [PPQ * 4, PPQ * 4 * 16],
    ]);
    expect(result.segments.every((segment) => segment.confidence === "certain")).toBe(true);
    expect(phraseAtTick(result.segments, PPQ * 4)).toMatchObject({
      fromTick: PPQ * 4,
    });
  });

  it("合并重复边界并优先保留人工边界", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [
      {
        id: "ambiguous",
        tick: PPQ,
        source: "inferred",
        confidence: "ambiguous",
      },
      {
        id: "certain",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];

    const result = analyzePhrases(project);

    expect(result.boundaries.filter((boundary) => boundary.tick === PPQ)).toEqual([
      expect.objectContaining({ id: "certain", source: "manual" }),
    ]);
  });

  it("按有效时长中点识别具有实际停顿的双乐句模板", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 5, PPQ * 8],
    ]);

    const analyzed = analyzePhrases(project);
    const inferred = inferPhrases(project);
    const boundary = inferred.boundaries.find((item) => item.tick === PPQ * 4);

    expect(analyzed.template.kind).toBe("duple");
    expect(analyzed.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tick: PPQ * 4,
        targetRatio: "half",
        support: "strong",
      }),
    ]));
    expect(boundary).toMatchObject({
      source: "inferred",
      confidence: "probable",
      stale: false,
    });
    expect(isCurrentPhraseBoundary(project, boundary!)).toBe(true);
  });

  it("普通整齐重奏和强拍不会把连续材料切成多个乐句", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 12;
    project.loop.endTick = project.lengthTicks;
    setIntervals(
      project,
      Array.from({ length: 12 }, (_, index) =>
        [index * PPQ, (index + 1) * PPQ] as const),
    );

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      project.lengthTicks,
    ]);
  });

  it("规整乐段的中点凭长音释放和原位属收束分句，转位属七连续解决时保留整句", () => {
    const score = `satb 1
key C major
meter 4/4
bars 1..4 {
  S: | E5/1 | D5/1 | E5/1 | C5/1 |
  A: | G4/1 | G4/1 | G4/1 | G4/1 |
  T: | C4/1 | B3/1 | C4/1 | E4/1 |
  B: | C3/1 | G2/1 | C3/1 | C3/1 |
  H: | T/1 | D/1 | T/1 | T/1 |
}`;
    const midpoint = (source: string) => inferPhrases(compileScoreText(source).project).boundaries
      .filter(boundary => boundary.tick === 8 * PPQ);
    expect(midpoint(score)).toMatchObject([{ confidence: "probable" }]);
    expect(midpoint(score.replace("| D/1 |", "| iii7/1 |").replace("| G2/1 |", "| E3/1 |"))).toEqual([]);
    expect(midpoint(score.replace("| D/1 | T/1", "| D2/1 | T6/1")
      .replace("| G2/1 | C3/1", "| F2/1 | E2/1"))).toEqual([]);
  });

  it("经过四六连接主和弦及其六和弦时保留连续乐句，实际休止仍可分句", () => {
    const project = passingSixFourProject();
    const cut = 13 * PPQ;
    const passing = project.chordTrack.regions.find(chord => chord.startTick === cut)!;
    passing.semantics!.cadenceRole = undefined;
    expect(inferPhrases(project).boundaries.map(boundary => boundary.tick)).toContain(cut);

    passing.semantics!.cadenceRole = "passing64";
    expect(inferPhrases(project).template.kind).toBe("single");

    for (const track of project.satbTracks) {
      track.notes = track.notes.flatMap(note => {
        if (note.startTick >= cut + PPQ || note.startTick + note.durationTicks <= cut) return [note];
        if (note.startTick < cut) return [{ ...note, durationTicks: cut - note.startTick }];
        return [];
      });
    }
    expect(inferPhrases(project).candidates).toContainEqual(expect.objectContaining({
      tick: cut, support: "strong", evidence: expect.arrayContaining([
        expect.objectContaining({ code: "silence-after-target" }),
      ]),
    }));
  });

  it.each([
    ["经过音跳八度", 13],
    ["解决音跳八度", 14],
  ] as const)("经过四六虽有标记，%s 时仍保留句界候选", (_name, beat) => {
    const project = passingSixFourProject();
    const bass = project.satbTracks.find(track => track.id === "bass")!;
    bass.notes.find(note => note.startTick === beat * PPQ)!.pitch.octave += 1;

    expect(inferPhrases(project).boundaries.map(boundary => boundary.tick)).toContain(13 * PPQ);
  });

  it("和弦低音缺少八度信息时保留句界候选", () => {
    const project = passingSixFourProject();
    const result = inferPhrases({
      ...project,
      satbTracks: project.satbTracks.filter(track => track.id !== "bass"),
    });

    expect(result.boundaries.map(boundary => boundary.tick)).toContain(13 * PPQ);
  });

  it("经过四六跨越印刷调号或局部调变化时保留句界候选", () => {
    const project = passingSixFourProject();
    const cut = 13 * PPQ;
    const changedKey = { tonic: { step: "G", alter: 0 }, mode: "major" } as const;
    const passing = project.chordTrack.regions.find(chord => chord.startTick === cut)!;
    passing.semantics!.interpretations[0].localKey = changedKey;
    expect(inferPhrases(project).boundaries.map(boundary => boundary.tick)).toContain(cut);

    passing.semantics!.interpretations[0].localKey = undefined;
    project.keyEvents.push({ id: "new-key", tick: cut + PPQ / 2, ...changedKey });
    const inferred = inferPhrases(project).boundaries.find(boundary => boundary.tick === cut)!;
    expect(inferred).toBeDefined();
    expect(isCurrentPhraseBoundary(project, inferred)).toBe(true);
    project.keyEvents.pop();
    expect(isCurrentPhraseBoundary(project, inferred)).toBe(false);
  });

  it("经过四六的和声证据被排除后，次强拍上的独立长音释放仍支持句界", () => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..7 {
  S: | E5/1 | F5/1 | E5/1 | G4/1 | A4/1 | D5/1 | C5/1 |
  A: | G4/1 | C5/1 | G4/1 | G4/2 E4/2 | F4/1 | G4/1 | G4/1 |
  T: | C4/1 | A3/1 | E4/1 | C4/4 B3/4 C4/2 | C4/1 | B3/1 | E4/1 |
  B: | C3/1 | F3/1 | C3/1 | E3/4 D3/4 C3/2 | F3/1 | G2/1 | C3/1 |
  H: | T/1 | S/1 | T/1 | T6/4 D64/4 T/2 | S/1 | D/1 | T/1 |
}`).project;
    const passing = project.chordTrack.regions.find(chord => chord.startTick === 13 * PPQ)!;
    passing.semantics!.cadenceRole = "passing64";

    const candidate = inferPhrases(project).template.boundaries[0];
    expect(candidate).toMatchObject({ tick: 14 * PPQ, support: "moderate" });
    expect(candidate?.evidence.map(item => item.code)).toEqual([
      "regular-template-target", "long-note-release", "metric-support",
    ]);
  });

  it("辅助四六的回归不会为附近的属二落点提供句界证据，人工句界仍然生效", () => {
    const project = auxiliarySixFourProject();
    const cut = 16 * PPQ;
    const auxiliary = project.chordTrack.regions.find(chord => chord.startTick === 13 * PPQ)!;
    auxiliary.semantics!.cadenceRole = undefined;
    expect(inferPhrases(project).boundaries.map(boundary => boundary.tick)).toContain(cut);

    auxiliary.semantics!.cadenceRole = "pedal64";
    expect(inferPhrases(project).template.kind).toBe("single");

    project.structure.phraseBoundaries = [{ id: "manual-break", tick: cut, source: "manual", confidence: "certain" }];
    expect(inferPhrases(project).boundaries).toContainEqual(expect.objectContaining({
      id: "manual-break", tick: cut, source: "manual",
    }));
  });

  it.each([
    ["中间低音跨八度", { step: "E", alter: 0, octave: 4 }],
    ["实际低音转为根音", { step: "A", alter: 0, octave: 2 }],
  ] as const)("辅助四六的低音%s时保留分句证据，并使旧指纹失效", (_name, pitch) => {
    const project = auxiliarySixFourProject("E3/4 E3/4 E3/4");
    expect(inferPhrases(project).template.kind).toBe("single");
    const oldFingerprint = phraseInferenceFingerprint(project);

    const bass = project.satbTracks.find(track => track.id === "bass")!;
    bass.notes.find(note => note.startTick === 13 * PPQ)!.pitch = pitch;

    expect(phraseInferenceFingerprint(project)).not.toBe(oldFingerprint);
    expect(inferPhrases(project).boundaries.map(boundary => boundary.tick)).toContain(16 * PPQ);
  });

  it("辅助四六缺实际低音或低音中间休止时保留分句证据", () => {
    const project = auxiliarySixFourProject();
    const withoutBass = { ...project, satbTracks: project.satbTracks.filter(track => track.id !== "bass") };
    const withBassRest = auxiliarySixFourProject("E3/4 r/4 E3/4");

    expect(inferPhrases(withoutBass).boundaries.map(boundary => boundary.tick)).toContain(16 * PPQ);
    expect(inferPhrases(withBassRest).boundaries.map(boundary => boundary.tick)).toContain(16 * PPQ);
  });
  it("长音在同一拍立即重奏时不建立强乐句边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 4, PPQ * 8],
    ]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries).toHaveLength(2);
  });

  it("同时支持两个规整断点时选择三乐句模板", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 24;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 8],
      [PPQ * 9, PPQ * 16],
      [PPQ * 17, PPQ * 24],
    ]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("triple");
    expect(result.boundaries.filter((boundary) =>
      boundary.tick > 0 && boundary.tick < project.lengthTicks)
      .map((boundary) => boundary.tick)).toEqual([PPQ * 8, PPQ * 16]);
  });

  it("即使三个比例位置都有强断点，也最多生成两个内部边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 48;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 16],
      [PPQ * 17, PPQ * 24],
      [PPQ * 25, PPQ * 32],
      [PPQ * 33, PPQ * 48],
    ]);

    const result = inferPhrases(project);
    const automatic = result.boundaries.filter(
      (boundary) => boundary.tick > 0 && boundary.tick < project.lengthTicks,
    );

    expect(automatic.length).toBeLessThanOrEqual(2);
    expect(result.segments.length).toBeLessThanOrEqual(3);
  });

  it("有效时长会排除结尾空白，不把音乐结束误作内部边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [[0, PPQ * 4]]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries).toHaveLength(2);
  });

  it("输入改变后不再将旧的自动边界用于实时分析", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 5, PPQ * 8],
    ]);
    project.structure.phraseBoundaries = inferPhrases(project).boundaries.filter(
      (item) => item.tick > 0 && item.tick < project.lengthTicks,
    );
    project.satbTracks[0].notes[0].durationTicks += 1;

    const result = analyzePhrases(project, { generateCandidates: false });

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      project.lengthTicks,
    ]);
  });
});
