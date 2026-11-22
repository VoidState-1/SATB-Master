import { describe, expect, it } from "vitest";
import { applyHarmonyInference, applyChordInference, inferHarmony, inferChords } from "..";
import { updateChordRegion } from "../../../editing";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../../project";
import { spellMidi } from "../../../pitch";
import { buildHarmonyAnalysis } from "../../analysis";
import { compileScoreText } from "../../../scoreText";
import { buildChordInferenceObservations } from "../observations";

function chordNote(
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
    (midiNote, index) => chordNote(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
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
        chordNote(`${track.id}-${index}`, index * PPQ * 4 / count, PPQ * 4 / count, pitches[track.voice]),
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
          chordNote(
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
        chordNote(`${track.id}-first`, 0, PPQ * 4, pitches[track.voice]),
        chordNote(`${track.id}-second`, PPQ * 5, PPQ * 3, pitches[track.voice]),
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
      chordNote("soprano-extra", 0, PPQ, 74, { nonChordToneRole: "passing" }),
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
      chordNote("soprano-extra", 0, PPQ, 74, { nonChordToneRole: "passing" }),
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

function scoreWithRole(role: string) {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
  S: | C5/2 | C5/2 | C5/4. D5/8@extra |
  A: | G4/2 | G4/2 | G4/2 |
  T: | E4/2 | E4/2 | E4/2 |
  B: | C3/2 | C3/2 | C3/2 |
}
annotations {
  note extra role=${role}
}`).project;
}

function extraNote(project: ReturnType<typeof scoreWithRole>) {
  return project.satbTracks.find(track => track.voice === "soprano")!.notes.at(-1)!;
}

describe("选区内非和弦音角色写回", () => {
  it.each(["anticipation", "passing", "suspension"])("%s 仅写回在选区内起奏的音符", role => {
    const project = scoreWithRole(role);
    const note = extraNote(project);
    expect(note.startTick).toBe(5280);

    // Use an inferred assignment with known evidence to exercise writing the
    // role to a destination note that does not already have that role.
    const target = structuredClone(project);
    delete extraNote(target).nonChordToneRole;
    const options = { mode: "fill-gaps", writeNonChordToneRoles: true } as const;
    const clipped = inferChords(project, { fromTick: 5400, toTick: 5460 });
    expect(clipped.regions[0]?.selected?.fit.nonChordToneAssignments).toEqual({ [note.id]: role });
    const outsideAttack = applyChordInference(target, clipped, options);
    expect(outsideAttack.appliedRegionCount).toBe(1);
    expect(outsideAttack.project.chordTrack.regions[0]).toMatchObject({ startTick: 5400, durationTicks: 60 });
    expect(outsideAttack.writtenNonChordToneRoleCount).toBe(0);
    expect(extraNote(outsideAttack.project).nonChordToneRole).toBeUndefined();

    const includesAttack = inferChords(project, { fromTick: 5280, toTick: 5400 });
    const insideAttack = applyChordInference(target, includesAttack, options);
    expect(insideAttack.appliedRegionCount).toBe(1);
    expect(insideAttack.writtenNonChordToneRoleCount).toBe(1);
    expect(extraNote(insideAttack.project).nonChordToneRole).toBe(role);
  });
});

function observationNote(
  id: string,
  startTick: number,
  durationTicks: number,
  midiNote: number,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function addNote(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  value: NoteEvent,
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes.push(value);
}

describe("和弦推导音符观察", () => {
  it("按音符边界建立观察，并忽略已有和弦边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addNote(project, "soprano", observationNote("s0", 0, PPQ * 2, 72));
    addNote(project, "alto", observationNote("a0", 0, PPQ * 2, 67));
    addNote(project, "tenor", observationNote("t0", 0, PPQ * 2, 64));
    addNote(project, "bass", observationNote("b0", 0, PPQ, 48));
    addNote(project, "bass", observationNote("b1", PPQ, PPQ, 55));
    project.chordTrack.regions.push({
      id: "stale-chord-boundary",
      startTick: PPQ / 2,
      durationTicks: PPQ / 2,
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
    });

    const observations = buildChordInferenceObservations(project);

    expect(observations.map((item) => [item.fromTick, item.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
    ]);
    expect(observations[0].bass?.id).toBe("b0");
    expect(observations[1].bass?.id).toBe("b1");
    expect(observations[0].completeSatb).toBe(true);
    expect(observations[0].metric?.role).toBe("downbeat");
  });

  it("限制范围时只返回范围内的半开观察区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    addNote(project, "soprano", observationNote("s0", 0, PPQ * 4, 72));
    addNote(project, "alto", observationNote("a0", 0, PPQ * 4, 67));
    addNote(project, "tenor", observationNote("t0", 0, PPQ * 4, 64));
    addNote(project, "bass", observationNote("b0", 0, PPQ * 4, 48));

    const observations = buildChordInferenceObservations(project, {
      fromTick: PPQ,
      toTick: PPQ * 3,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      fromTick: PPQ,
      toTick: PPQ * 3,
    });
  });
});

const score = `satb 1
key G major
meter 3/4
bars 1..6 {
  S: | B4/2 C5/4 | B4/2 B4/4 | C5/2 C5/4 | C5/2 C5/4 | C5/2 B4/4 | C5/2. |
  A: | G4/2 A4/4 | G4/2 F4/4 | Eb4/2 E4/4 | F4/2 F#4/4 | G4/2 G4/4 | G4/2. |
  T: | D4/2 D4/4 | D4/2 G3/4 | G3/2 G3/4 | F3/4 Eb3/4 D4/4 | Eb4/2 F4/4 | Eb4/2. |
  B: | G2/2 F#2/4 | G2/2 D3/4 | C3/2 Bb2/4 | Ab2/2 Ab2/4 | G2/2 G2/4 | C3/2. |
}`;

function atFourthBar(text: string, selection = false) {
  const { project } = compileScoreText(text);
  const beat = 9 * project.ppq;
  const result = inferChords(project, selection ? { fromTick: beat, toTick: beat + project.ppq } : {});
  return result.regions.find(r => r.fromTick <= beat && beat < r.toTick)?.selected;
}

const cMinor = { tonic: { step: "C", alter: 0 }, mode: "minor" };
const fMinor = { tonic: { step: "F", alter: 0 }, mode: "minor" };

describe("用低音持续时间判断局部调", () => {
  it.each([false, true])("四部已在同音低音上换和声，保留经确认的 c 小调（选区 %s）", selection => {
    const result = atFourthBar(score, selection);
    expect(result?.semantics?.interpretations[0]).toMatchObject({ degree: 4, localKey: cMinor });
    expect(result?.identity).toMatchObject({ root: { step: "F" }, bass: { step: "A", alter: -1 } });
  });

  it("主和弦已奏满一小节后才改变上声部时，仍能确立局部调", () => {
    const extended = score.replace("1..6", "1..7")
      .replace("C5/4 | C5/2 C5/4", "C5/4 | C5/2. | C5/2 C5/4")
      .replace("E4/4 | F4/2", "E4/4 | F4/2. | F4/2")
      .replace("G3/4 | F3/4", "G3/4 | F3/2. | F3/4")
      .replace("Bb2/4 | Ab2/2", "Bb2/4 | Ab2/2. | Ab2/2");
    expect(atFourthBar(extended)?.semantics?.interpretations[0].localKey).toEqual(fMinor);
  });

  it("尊重已标明的外音角色", () => {
    const { project } = compileScoreText(score);
    const lastBeat = 11 * project.ppq;
    project.satbTracks.find(track => track.id === "alto")!.notes.find(note => note.startTick === lastBeat)!.nonChordToneRole = "passing";
    const at = 9 * project.ppq;
    const region = inferChords(project).regions.find(r => r.fromTick <= at && at < r.toTick);
    expect(region?.selected?.semantics?.interpretations[0].localKey).toEqual(fMinor);
  });

  it.each([
    ["实际低音持续", score.replace("Ab2/2 Ab2/4", "Ab2/2.")],
    ["低音重奏、上方仍是完整主和弦", score.replace("F4/2 F#4/4", "F4/2 Ab4/4").replace("Eb3/4 D4/4", "Eb3/4 F3/4")],
    ["各部重奏、只有一个音在主三和弦之外", score.replace("F4/2 F#4/4", "F4/2 F4/4")],
    ["同一低音上双邻音在小节内已解决", score.replace("F4/2 F#4/4", "F4/4 G4/4 F4/4")
      .replace("F3/4 Eb3/4 D4/4", "F3/4 G3/4 F3/4").replace("C5/4 | C5/2 C5/4", "C5/4 | C5/4 Db5/4 C5/4")
      .replace("Ab2/2 Ab2/4", "Ab2/4 Ab2/4 Ab2/4")],
  ])("%s 时保留原有 f 小调证据", (_name, example) => {
    expect(atFourthBar(example)?.semantics?.interpretations[0]).toMatchObject({ degree: 1, localKey: fMinor });
  });
});
