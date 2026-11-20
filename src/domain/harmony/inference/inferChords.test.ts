import { describe, expect, it } from "vitest";
import {
  applyHarmonyInference,
  applyChordInference,
  inferHarmony,
  inferChords,
} from "./index";
import { updateChordRegion } from "../../editing";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../project";
import { spellMidi } from "../../pitch";
import { buildHarmonyAnalysis } from "../analysis";
import { compileScoreText } from "../../scoreText";

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  midiNote: number,
  patch: Partial<NoteEvent> = {},
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
    ...patch,
  };
}

function addLine(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  values: readonly number[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = values.map(
    (midiNote, index) => note(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
  );
}

function addHarmony(project: ReturnType<typeof createEmptyProject>) {
  addLine(project, "soprano", [72, 74, 72]);
  addLine(project, "alto", [67, 71, 67]);
  addLine(project, "tenor", [64, 67, 64]);
  addLine(project, "bass", [48, 55, 48]);
  project.lengthTicks = PPQ * 3;
}

describe("自动和弦推导", () => {
  it("区分和声小调的减导七及等音改写后的不同根音", () => {
    const { project } = compileScoreText(`satb 1
key E minor
meter 3/4
bars 1..1 {
S: | F#5/4 Gb5/4 F5/4 |
A: | A4/4 A4/4 Ab4/4 |
T: | C4/4 C4/4 B3/4 |
B: | D#3/4 Eb3/4 D3/4 |
}`);
    const regions = inferChords(project).regions;
    expect(regions[0]).toMatchObject({
      fromTick: 0, toTick: PPQ, status: "resolved",
      selected: { functionalBaseId: "DVII", identity: { root: { step: "D", alter: 1 } } },
    });
    for (const tick of [PPQ, 2 * PPQ]) {
      const region = regions.find(item => item.fromTick <= tick && tick < item.toTick)!;
      expect(region.selected?.functionalBaseId).not.toBe("DVII");
    }
  });

  it("重属导七保留已写明的根音及等音七音的备选读法", () => {
    const { project } = compileScoreText(`satb 1
key G major
meter 1/4
bars 1..2 {
S: | A#4/4 | B4/4 |
A: | G4/4 | G4/4 |
T: | E4/4 | D4/4 |
B: | C#3/4 | D3/4 |
}`);
    const candidate = inferChords(project).regions[0].selected;
    expect(candidate).toMatchObject({
      functionalBaseId: "DDVII", identity: { root: { step: "C", alter: 1 } },
      fit: { spellingConsistent: false },
    });
  });

  it("同调重申处切分可写回的和弦，普通重复起奏仍然合并", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
at 1:3 key C major
bars 1..1 {
  S: | E5/4 E5/4 E5/4 E5/4 |
  A: | C5/1 |
  T: | G4/1 |
  B: | C3/1 |
}`);
    for (const [fromTick, toTick] of [[0, 4 * PPQ], [PPQ / 2, 3 * PPQ]]) {
      const result = inferChords(project, { fromTick, toTick });
      const applied = applyChordInference(project, result, { mode: "fill-gaps" });
      expect(applied.skipped).toEqual([]);
      expect(applied.project.chordTrack.regions.map(region => [
        region.startTick, region.startTick + region.durationTicks, region.identity.root.step,
      ])).toEqual([[fromTick, 2 * PPQ, "C"], [2 * PPQ, toTick, "C"]]);
    }
  });

  it("按时间序列合并连续的同一功能，并保留不同功能区段", () => {
    const project = createEmptyProject();
    addHarmony(project);

    const result = inferChords(project);

    expect(result.regions.map((region) => [region.fromTick, region.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
      [PPQ * 2, PPQ * 3],
    ]);
    expect(result.regions.map((region) => region.selected?.functionalBaseId)).toEqual([
      "T",
      "D",
      "T",
    ]);
  });

  it("结合后续属功能识别终止四六，而不是只按实体标记为 T", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [76, 77]);
    addLine(project, "alto", [72, 74]);
    addLine(project, "tenor", [67, 71]);
    addLine(project, "bass", [55, 55]);

    const result = inferChords(project);
    expect(result.regions[0].selected?.functionalBaseId).toBe("K46");
    expect(result.regions[0].status).toBe("resolved");
    expect(result.regions[1].selected?.functionalBaseId).toBe("D");
  });

  it.each([1, 2, 4])("重复起奏 %i 次不会消除主四六与终止四六的歧义", (count) => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    const pitches: Record<VoiceId, number> = {
      soprano: 76, alto: 72, tenor: 67, bass: 55,
    };
    for (const track of project.satbTracks) {
      track.notes = Array.from({ length: count }, (_, index) =>
        note(`${track.id}-${index}`, index * PPQ * 4 / count, PPQ * 4 / count, pitches[track.voice]),
      );
    }

    const result = inferChords(project);

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].status).toBe("ambiguous");
    expect(result.regions[0].selected?.functionalBaseId).toBe("T");
    expect(result.regions[0].alternatives.find((candidate) =>
      candidate.functionalBaseId === "K46",
    )?.score.total).toBeCloseTo(result.regions[0].selected!.score.total);
    expect(applyChordInference(project, result, { mode: "fill-gaps" }).appliedRegionCount).toBe(0);
  });

  it("合并区段保留后续切片的非和弦音证据和较低置信度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [72, 74]);
    addLine(project, "alto", [67, 67]);
    addLine(project, "tenor", [64, 64]);
    addLine(project, "bass", [48, 48]);
    project.satbTracks.find((track) => track.voice === "soprano")!.notes[1]
      .nonChordToneRole = "passing";

    const result = inferChords(project);

    expect(result.regions).toHaveLength(1);
    const selected = result.regions[0].selected!;
    expect(selected.functionalBaseId).toBe("T");
    expect(selected.confidence).toBe("medium");
    expect(selected.fit.matchedNoteIds).toHaveLength(8);
    expect(selected.fit.nonChordToneAssignments).toEqual({ "soprano-1": "passing" });
    expect(selected.evidence).toContainEqual(expect.objectContaining({
      kind: "declared-nonchord-tone", noteIds: ["soprano-1"],
    }));
  });

  it.each([false, true])("单独重复的降六级音不能写成增六和弦（有限缺音 %s）", (allowIncompleteVoicing) => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "bass", [56, 56]);
    for (const bassNote of project.satbTracks.find((track) => track.voice === "bass")!.notes) {
      bassNote.pitch = { step: "A", alter: -1, octave: 2 };
    }

    const result = inferChords(project, { allowIncompleteVoicing });

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].status).toBe("unclassified");
    expect(result.regions[0].selected).toBeUndefined();
    expect(applyChordInference(project, result, { mode: "fill-gaps" }).appliedRegionCount).toBe(0);
  });

  it("全终止末端可推断省略五音的主和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [74, 76]);
    addLine(project, "alto", [71, 72]);
    addLine(project, "tenor", [67, 60]);
    addLine(project, "bass", [43, 48]);

    const result = inferChords(project);

    expect(result.regions.at(-1)?.selected?.functionalBaseId).toBe("T");
    expect(result.regions.at(-1)?.status).toBe("resolved");
    expect(result.regions.at(-1)?.selected?.fit.omittedChordDegrees).toEqual([
      5,
    ]);
  });

  it("局部推导时直接识别根音三次加三音的主和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [77, 76]);
    addLine(project, "alto", [71, 60]);
    addLine(project, "tenor", [67, 60]);
    addLine(project, "bass", [55, 48]);

    const result = inferChords(project, {
      fromTick: PPQ,
      toTick: PPQ * 2,
    });

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].selected?.functionalBaseId).toBe("T");
    expect(result.regions[0].status).toBe("resolved");
    expect(result.regions[0].selected?.fit.omittedChordDegrees).toEqual([5]);
  });

  it("可推断省略五音的根根三七属和弦并进入终止主和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addLine(project, "soprano", [77, 76]);
    addLine(project, "alto", [71, 72]);
    addLine(project, "tenor", [67, 60]);
    addLine(project, "bass", [55, 48]);

    const result = inferChords(project);

    expect(result.regions.map((region) => region.selected?.functionalBaseId)).toEqual([
      "D",
      "T",
    ]);
    expect(result.regions[0].selected?.fit.omittedChordDegrees).toEqual([]);
    expect(result.regions[1].selected?.functionalBaseId).toBe("T");
  });

  it("在自动乐句边界处识别省略五音的终止主和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
      const pitches =
        voiceId === "soprano"
          ? [72, 77, 76, 72]
          : voiceId === "alto"
            ? [67, 71, 72, 67]
            : voiceId === "tenor"
              ? [64, 67, 60, 64]
              : [48, 55, 48, 48];
      const starts = [0, PPQ * 2, PPQ * 3, PPQ * 5];
      const durations = [PPQ * 2, PPQ, PPQ, PPQ * 3];
      project.satbTracks.find((track) => track.id === voiceId)!.notes =
        pitches.map((midiNote, index) =>
          note(
            `${voiceId}-${index}`,
            starts[index],
            durations[index],
            midiNote,
          ),
        );
    }

    const result = inferChords(project);
    const terminal = result.regions.find(
      (region) => region.fromTick === PPQ * 3 && region.toTick === PPQ * 4,
    );
    expect(terminal?.selected?.functionalBaseId).toBe("T");
    expect(terminal?.selected?.fit.omittedChordDegrees).toEqual([5]);

    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps",
    });
    const analysis = buildHarmonyAnalysis(applied.project);
    expect(analysis.cadenceCandidates.some(
      (candidate) =>
        candidate.kind === "full" &&
        candidate.fromTick === PPQ * 2 &&
        candidate.toTick === PPQ * 4,
    )).toBe(true);
  });

  it("默认只应用已解析区段，并保护已有和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [72]);
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = inferChords(project);

    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
    });

    expect(applied.skipped).toHaveLength(0);
    expect(applied.project.chordTrack.regions).toHaveLength(1);
    expect(applied.project.chordTrack.regions[0].semantics?.interpretations[0].source).toBe(
      "inferred",
    );
    expect(project.chordTrack.regions).toHaveLength(0);

    const again = applyChordInference(applied.project, result, {
      mode: "fill-gaps",
    });
    expect(again.project.chordTrack.regions).toHaveLength(1);
    expect(again.skipped[0]?.code).toBe("overlap");
  });

  it("无停顿的短和声进行不会被自动切成多个乐句", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    addLine(project, "soprano", [72, 74, 72]);
    addLine(project, "alto", [67, 71, 69]);
    addLine(project, "tenor", [64, 67, 65]);
    addLine(project, "bass", [48, 55, 53]);

    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps",
    });
    const analysis = buildHarmonyAnalysis(applied.project);

    expect(applied.appliedPhraseBoundaryCount).toBe(0);
    expect(applied.appliedPhraseTemplate).toBe("single");
    expect(applied.project.structure.phraseBoundaries).toEqual([]);
    expect(analysis.phraseSegments).toHaveLength(1);
    expect(analysis.cadenceCandidates.some((candidate) =>
      candidate.kind === "half")).toBe(false);
  });

  it("应用和弦推导后按中点实际停顿写入双乐句结构", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    const pitches: Record<VoiceId, number> = {
      soprano: 72,
      alto: 67,
      tenor: 64,
      bass: 48,
    };
    project.satbTracks.forEach((track) => {
      track.notes = [
        note(`${track.id}-first`, 0, PPQ * 4, pitches[track.voice]),
        note(`${track.id}-second`, PPQ * 5, PPQ * 3, pitches[track.voice]),
      ];
    });

    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps",
    });

    expect(applied.appliedPhraseTemplate).toBe("duple");
    expect(applied.appliedPhraseBoundaryCount).toBe(1);
    expect(applied.project.structure.phraseBoundaries).toEqual([
      expect.objectContaining({
        tick: PPQ * 4,
        source: "inferred",
        inferenceFingerprint: expect.any(String),
      }),
    ]);
  });

  it("重新推导只替换自动边界，并保留人工覆盖", () => {
    const project = createEmptyProject();
    addHarmony(project);
    project.structure.phraseBoundaries = [
      {
        id: "manual-boundary",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
        locked: true,
      },
      {
        id: "old-inferred-boundary",
        tick: PPQ * 2,
        source: "inferred",
        confidence: "probable",
        inferenceFingerprint: "outdated",
        stale: true,
      },
    ];

    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps",
    });

    expect(applied.project.structure.phraseBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual-boundary",
          tick: PPQ,
          source: "manual",
          locked: true,
        }),
      ]),
    );
    expect(applied.project.structure.phraseBoundaries).toHaveLength(1);
    expect(applied.project.structure.phraseBoundaries.some(
      (boundary) => boundary.source === "inferred",
    )).toBe(false);
  });

  it("替换未锁定模式只替换可编辑重叠区域", () => {
    const project = createEmptyProject();
    addHarmony(project);
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        id: "existing-tonic",
        startTick: 0,
        durationTicks: PPQ,
        identity: {
          root: { step: "C", alter: 0 },
          bass: { step: "C", alter: 0 },
          structure: {
            kind: "tertian",
            quality: "major",
            extensions: [],
            alterations: [],
          },
        },
        locked: false,
      },
      {
        id: "locked-dominant",
        startTick: PPQ,
        durationTicks: PPQ,
        identity: {
          root: { step: "G", alter: 0 },
          bass: { step: "G", alter: 0 },
          structure: {
            kind: "tertian",
            quality: "major",
            extensions: [],
            alterations: [],
          },
        },
        locked: true,
      },
    ];

    const applied = applyChordInference(project, inferChords(project), {
      mode: "replace-unlocked",
    });

    expect(applied.appliedRegionCount).toBe(1);
    expect(applied.project.chordTrack.regions).toHaveLength(2);
    expect(applied.project.chordTrack.regions.some((region) => region.id === "existing-tonic"))
      .toBe(false);
    expect(applied.project.chordTrack.regions.find((region) => region.id === "locked-dominant")?.locked)
      .toBe(true);
    expect(applied.skipped.some((warning) => warning.code === "locked-chord")).toBe(true);
  });

  it("应用阶段可选地写入已有依据的非和弦音角色", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.satbTracks.find((track) => track.id === "soprano")!.notes = [
      note("soprano-extra", 0, PPQ, 74, { nonChordToneRole: "passing" }),
    ];
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = inferChords(project, {
      allowNonChordToneCandidates: true,
    });

    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
      writeNonChordToneRoles: true,
    });

    expect(applied.project.satbTracks.find((track) => track.id === "soprano")!.notes[0]
      .nonChordToneRole).toBe("passing");
  });

  it("应用写回开关不会把未声明的额外音变成可接受候选", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [74]);
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);

    const result = inferChords(project);
    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
      writeNonChordToneRoles: true,
    });

    expect(result.regions[0]?.selected).toBeUndefined();
    expect(applied.appliedRegionCount).toBe(0);
    expect(applied.project.chordTrack.regions).toHaveLength(0);
  });

  it("手动编辑自动和弦后将语义来源改为 manual", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [72]);
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    const result = applyChordInference(project, inferChords(project), {
      mode: "fill-gaps",
    });
    const chord = result.project.chordTrack.regions[0];
    const edited = updateChordRegion(result.project, chord.id, {
      draft: { inversion: 1 },
    });

    expect(edited.error).toBeUndefined();
    expect(
      edited.project.chordTrack.regions[0].semantics?.interpretations[0].source,
    ).toBe("manual");
  });

  it("绝对回退不会在默认中等置信度阈值下直接应用", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addLine(project, "soprano", [73]);
    addLine(project, "alto", [70]);
    addLine(project, "tenor", [66]);
    addLine(project, "bass", [54]);

    const result = inferChords(project, { allowAbsoluteFallback: true });

    expect(result.regions[0].selected?.confidence).toBe("low");
    expect(result.regions[0].status).toBe("ambiguous");
    expect(result.warnings[0]?.code).toBe("ambiguous");
    expect(
      applyChordInference(project, result, { mode: "fill-gaps" }).appliedRegionCount,
    ).toBe(0);
  });

  it("不跨调性边界合并未归类区段", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents.push({
      id: "key-g",
      tick: PPQ,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });

    const result = inferChords(project);

    expect(result.regions.map((region) => [region.fromTick, region.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
    ]);
  });

  it("写入非和弦音角色时遵守锁定声部和不可编辑区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.satbTracks.find((track) => track.id === "soprano")!.notes = [
      note("soprano-extra", 0, PPQ, 74, { nonChordToneRole: "passing" }),
    ];
    addLine(project, "alto", [67]);
    addLine(project, "tenor", [64]);
    addLine(project, "bass", [48]);
    project.satbTracks.find((track) => track.id === "soprano")!.locked = true;
    project.exercise.editableRanges = [
      {
        id: "locked-range",
        voiceIds: ["soprano"],
        fromTick: 0,
        toTick: PPQ,
        editable: false,
      },
    ];
    const result = inferChords(project, {
      allowNonChordToneCandidates: true,
    });

    const applied = applyChordInference(project, result, {
      mode: "fill-gaps",
      writeNonChordToneRoles: true,
    });

    expect(applied.project.satbTracks.find((track) => track.id === "soprano")!.notes[0]
      .nonChordToneRole).toBe("passing");
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.skipped.some((warning) => warning.code === "locked-note")).toBe(true);
  });
});
