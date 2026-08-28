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
