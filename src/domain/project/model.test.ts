import { describe, expect, it } from "vitest";
import { createChordRegion } from "../chords";
import {
  createEmptyProject,
  migrateProject,
  PPQ,
  reconcileChordIdentities,
  validateProject,
  type ProjectDocument,
} from "./index";
import { keySignatureFifths, pitchClassValue, toMidi } from "../pitch";

function createV2Fixture() {
  const project = createEmptyProject("v2 迁移金样本");
  project.author = "迁移测试";
  project.lengthTicks = PPQ * 12;
  project.tempoEvents.push({ id: "tempo-2", tick: PPQ * 4, bpm: 108 });
  project.meterEvents.push({
    id: "meter-2",
    tick: PPQ * 8,
    numerator: 3,
    denominator: 4,
  });
  project.keyEvents.push({
    id: "key-g",
    tick: PPQ * 4,
    tonic: { step: "G", alter: 0 },
    mode: "major",
  });
  project.satbTracks[0].notes.push(
    {
      id: "legacy-c",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 91,
      locked: true,
      spellingSource: "manual",
    },
    {
      id: "legacy-f-sharp",
      startTick: PPQ * 4,
      durationTicks: PPQ / 2,
      pitch: { step: "F", alter: 1, octave: 5 },
      velocity: 73,
      locked: false,
      spellingSource: "manual",
    },
  );
  project.chordTrack.regions.push(
    createChordRegion(
      project,
      0,
      PPQ * 2,
      {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        source: "manual",
      confidence: "certain",
      },
      "legacy-chord",
    ),
  );
  project.loop = {
    enabled: true,
    startTick: PPQ,
    endTick: PPQ * 6,
  };
  project.exercise.instructions = "保留低音给定题";
  project.exercise.editableRanges.push({
    id: "locked-bass",
    voiceIds: ["bass"],
    fromTick: 0,
    toTick: PPQ * 4,
    editable: false,
  });
  project.audio = {
    masterVolume: 0.63,
    soundFont: {
      kind: "user",
      name: "Local.sf2",
      path: "C:\\Sounds\\Local.sf2",
      hash: "fixture-hash",
    },
  };

  const legacy = structuredClone(project) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 2;
  legacy.keyEvents = project.keyEvents.map((event) => ({
    ...event,
    tonic: pitchClassValue(event.tonic),
  }));
  legacy.tracks = project.satbTracks.map((track) => {
    const {
      kind: _kind,
      voice: _voice,
      participatesInHarmony: _participatesInHarmony,
      monophonic: _monophonic,
      ...legacyTrack
    } = track;
    return {
      ...legacyTrack,
      notes: track.notes.map((note) => {
        const { pitch, spellingSource: _spellingSource, ...legacyNote } = note;
        return { ...legacyNote, midiNote: toMidi(pitch) };
      }),
    };
  });
  legacy.chordTrack = {
    ...project.chordTrack,
    displayMode: "both",
    regions: project.chordTrack.regions.map((region) => ({
      id: region.id,
      startTick: region.startTick,
      durationTicks: region.durationTicks,
      analysis: {
        degree: region.semantics!.interpretations[0].degree,
        accidental: region.semantics!.interpretations[0].degreeAlteration,
        quality:
          region.identity.structure.kind === "tertian"
            ? region.identity.structure.quality
            : "major",
        inversion: 0,
      },
      locked: region.locked,
    })),
  };
  delete legacy.satbTracks;
  delete legacy.auxiliaryTracks;
  delete legacy.ruleProfile;
  return legacy;
}

describe("工程文件校验", () => {
  it("接受当前版本创建的完整工程", () => {
    expect(validateProject(createEmptyProject())).toBe(true);
  });

  it("拒绝旧的浅层结构伪装成完整工程", () => {
    const project = createEmptyProject() as unknown as Record<string, unknown>;
    delete project.audio;

    expect(validateProject(project)).toBe(false);
  });

  it("拒绝缺少零时刻基准的时间事件", () => {
    const project = createEmptyProject();
    project.tempoEvents[0].tick = 960;

    expect(validateProject(project)).toBe(false);
  });

  it("拒绝越界书写音高与非有限数值", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "bad-note",
      startTick: 0,
      durationTicks: 960,
      pitch: { step: "C", alter: 0, octave: 10 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });
    project.audio.masterVolume = Number.NaN;

    expect(validateProject(project)).toBe(false);
  });

  it("校验外置规则引用的标识、摘要、配置与唯一性", () => {
    const project = createEmptyProject();
    const reference = {
      ruleId: "example-rule",
      packageId: "org.example.rules",
      version: "1.0.0",
      contentHash: "a".repeat(64),
      severity: "warning" as const,
      enabled: true,
      configVersion: 1,
      config: { threshold: 4 },
      exceptions: {},
    };
    project.ruleProfile.external = [reference];
    expect(validateProject(project)).toBe(true);

    project.ruleProfile.external.push({ ...reference });
    expect(validateProject(project)).toBe(false);
    project.ruleProfile.external = [
      {
        ...reference,
        contentHash: "../invalid",
        config: { threshold: Infinity },
      },
    ];
    expect(validateProject(project)).toBe(false);
  });

  it("拒绝越过工程末尾的 SATB 或辅助轨音符", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "past-end",
      startTick: project.lengthTicks - PPQ / 2,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });

    expect(validateProject(project)).toBe(false);
  });

  it("拒绝无效练习区间和不一致的和弦实体", () => {
    const project = createEmptyProject();
    project.exercise.editableRanges.push({
      id: "bad-range",
      voiceIds: ["soprano"],
      fromTick: 960,
      toTick: 0,
      editable: false,
    });
    const chord = createChordRegion(
      project,
      0,
      PPQ,
      {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        source: "manual",
      confidence: "certain",
      },
      "bad-chord",
    );
    chord.identity.root = { step: "D", alter: 0 };
    project.chordTrack.regions.push(chord);

    expect(validateProject(project)).toBe(false);
  });

  it("拒绝重复解释 ID、缺失主解释和无效和弦结构", () => {
    const project = createEmptyProject();
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        0,
        PPQ,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "semantic-validation",
      ),
    );
    const duplicate = JSON.parse(JSON.stringify(project));
    duplicate.chordTrack.regions[0].semantics.interpretations.push({
      ...duplicate.chordTrack.regions[0].semantics.interpretations[0],
    });
    expect(validateProject(duplicate)).toBe(false);

    const missingPrimary = JSON.parse(JSON.stringify(project));
    missingPrimary.chordTrack.regions[0].semantics.primaryInterpretationId =
      "missing";
    expect(validateProject(missingPrimary)).toBe(false);

    const invalidStructure = JSON.parse(JSON.stringify(project));
    invalidStructure.chordTrack.regions[0].identity.structure = {
      kind: "augmented-sixth",
      variant: "unknown",
    };
    expect(validateProject(invalidStructure)).toBe(false);
  });

  it("调号改变后可统一重算功能和弦实体", () => {
    const project = createEmptyProject();
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        0,
        PPQ,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
      confidence: "certain",
        },
        "tonic",
      ),
    );
    project.keyEvents[0].tonic = { step: "G", alter: 0 };
    expect(validateProject(project)).toBe(false);

    reconcileChordIdentities(project);

    expect(project.chordTrack.regions[0].identity.root).toEqual({
      step: "G",
      alter: 0,
    });
    expect(validateProject(project)).toBe(true);
  });
});

describe("schema v2 -> v3 迁移", () => {
  it("保留音高、时间、力度、锁定、循环、练习和音频数据", () => {
    const legacy = createV2Fixture();
    const legacyTracks = legacy.tracks as Array<{
      notes: Array<{
        id: string;
        startTick: number;
        durationTicks: number;
        midiNote: number;
        velocity: number;
        locked: boolean;
      }>;
    }>;

    const migrated = migrateProject(legacy);

    expect(migrated).toBeDefined();
    expect(migrated?.schemaVersion).toBe(3);
    expect(validateProject(migrated)).toBe(true);
    expect(migrated?.auxiliaryTracks).toEqual([]);
    expect(migrated?.ruleProfile).toMatchObject({
      profileVersion: 2,
      catalogRevision: 1,
      title: "斯波索宾基础规则",
      external: [],
    });
    expect(Object.keys(migrated!.ruleProfile.builtin)).toHaveLength(81);
    expect(migrated?.chordTrack.displayMode).toBe("roman-absolute");
    expect(migrated?.loop).toEqual(legacy.loop);
    expect(migrated?.exercise).toEqual(legacy.exercise);
    expect(migrated?.audio).toEqual(legacy.audio);

    const migratedNotes = migrated!.satbTracks.flatMap((track) => track.notes);
    const legacyNotes = legacyTracks.flatMap((track) => track.notes);
    expect(migratedNotes).toHaveLength(legacyNotes.length);
    for (const legacyNote of legacyNotes) {
      const migratedNote = migratedNotes.find(
        (candidate) => candidate.id === legacyNote.id,
      );
      expect(migratedNote).toBeDefined();
      expect(toMidi(migratedNote!.pitch)).toBe(legacyNote.midiNote);
      expect(migratedNote).toMatchObject({
        id: legacyNote.id,
        startTick: legacyNote.startTick,
        durationTicks: legacyNote.durationTicks,
        velocity: legacyNote.velocity,
        locked: legacyNote.locked,
        spellingSource: "migrated",
      });
      expect(migratedNote).not.toHaveProperty("midiNote");
    }
    expect(
      migratedNotes.find((note) => note.id === "legacy-f-sharp")?.pitch,
    ).toEqual({ step: "F", alter: 1, octave: 5 });
    expect(migrated?.chordTrack.regions[0]).toMatchObject({
      id: "legacy-chord",
      startTick: 0,
      durationTicks: PPQ * 2,
      identity: {
        root: { step: "C", alter: 0 },
        structure: {
          kind: "tertian",
          quality: "major",
        },
      },
      semantics: {
        primaryInterpretationId: "primary",
        interpretations: [
          {
            degree: 1,
            degreeAlteration: 0,
            source: "manual",
            confidence: "certain",
          },
        ],
      },
    });
  });

  it("为缺少循环设置的 v2 工程补充默认循环", () => {
    const legacy = createV2Fixture();
    delete legacy.loop;

    expect(migrateProject(legacy)?.loop).toEqual({
      enabled: false,
      startTick: 0,
      endTick: PPQ * 4,
    });
  });

  it("按旧版 MIDI 语义迁移小调半音类拼写", () => {
    const legacy = createV2Fixture();
    legacy.keyEvents = [
      { id: "legacy-c-sharp-minor", tick: 0, tonic: 1, mode: "minor" },
    ];

    const migrated = migrateProject(legacy);
    expect(migrated?.keyEvents[0].tonic).toEqual({ step: "C", alter: 1 });
    expect(keySignatureFifths(migrated!.keyEvents[0])).toBe(4);
  });

  it("明确拒绝未公开的 schema v1，而不是猜测迁移", () => {
    const legacy = createV2Fixture();
    legacy.schemaVersion = 1;

    expect(migrateProject(legacy)).toBeUndefined();
  });

  it("当前 v3 工程不会被迁移器改写书写拼写", () => {
    const project: ProjectDocument = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "enharmonic",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "D", alter: -1, octave: 4 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });

    const normalized = migrateProject(project);
    expect(normalized?.satbTracks[0].notes[0].pitch).toEqual({
      step: "D",
      alter: -1,
      octave: 4,
    });
  });
});
