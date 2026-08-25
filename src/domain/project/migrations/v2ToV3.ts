import {
  isSeventhChord,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordQuality,
} from "../../chordModel";
import { legacyTonicSpelling, spellMidi, type Alteration } from "../../pitch";
import { createDefaultRuleProfile } from "../defaults";
import { normalizeProject } from "../normalize";
import type { KeyEvent, ProjectDocument } from "../types";
import { PPQ, PROJECT_SCHEMA_VERSION } from "../types";
import {
  chordQualities,
  hasString,
  isInteger,
  isRecord,
  validatePitchClass,
  validateProject,
} from "../validation";

function legacyKeyAtTick(events: KeyEvent[], tick: number) {
  return (
    [...events]
      .sort((a, b) => a.tick - b.tick)
      .filter((event) => event.tick <= tick)
      .at(-1) ?? events[0]
  );
}

function migrateLegacyChordDraft(value: unknown): ChordDraft | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isInteger(value.degree, 1, 7) ||
    !isInteger(value.accidental, -2, 2) ||
    !chordQualities.has(value.quality as ChordQuality)
  )
    return undefined;
  const maximumInversion = isSeventhChord(value.quality as ChordQuality)
    ? 3
    : 2;
  if (!isInteger(value.inversion, 0, maximumInversion)) return undefined;
  if (
    value.appliedToDegree !== undefined &&
    !isInteger(value.appliedToDegree, 1, 7)
  )
    return undefined;
  return {
    degree: value.degree as ChordDraft["degree"],
    degreeAlteration: value.accidental as Alteration,
    quality: value.quality as ChordQuality,
    inversion: value.inversion as ChordDraft["inversion"],
    appliedTarget: value.appliedToDegree as ChordDraft["appliedTarget"],
    source: "manual",
    confidence: "certain",
  };
}

function migrateV2Project(value: Record<string, unknown>) {
  if (!Array.isArray(value.keyEvents) || !Array.isArray(value.tracks))
    return undefined;
  const keyEvents = value.keyEvents.map((event) => {
    if (!isRecord(event) || !isInteger(event.tonic, 0, 11)) return event;
    return {
      ...event,
      tonic: legacyTonicSpelling(
        event.tonic as number,
        event.mode === "minor" ? "minor" : "major",
      ),
    };
  });
  if (
    !keyEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        validatePitchClass(event.tonic) &&
        ["major", "minor"].includes(event.mode as string),
    )
  )
    return undefined;
  const typedKeyEvents = keyEvents as KeyEvent[];

  const satbTracks = value.tracks.map((track) => {
    if (!isRecord(track) || !Array.isArray(track.notes)) return track;
    return {
      ...track,
      kind: "satb",
      voice: track.id,
      participatesInHarmony: true,
      monophonic: true,
      notes: track.notes.map((note) => {
        if (
          !isRecord(note) ||
          !isInteger(note.midiNote, 0, 127) ||
          !isInteger(note.startTick, 0)
        )
          return note;
        const key = legacyKeyAtTick(typedKeyEvents, note.startTick as number);
        const migrated = { ...note };
        delete migrated.midiNote;
        return {
          ...migrated,
          pitch: spellMidi(note.midiNote as number, key),
          spellingSource: "migrated",
        };
      }),
    };
  });

  const migrated = structuredClone(value);
  migrated.schemaVersion = PROJECT_SCHEMA_VERSION;
  migrated.keyEvents = keyEvents;
  migrated.satbTracks = satbTracks;
  migrated.auxiliaryTracks = [];
  delete migrated.tracks;
  migrated.ruleProfile = createDefaultRuleProfile();
  if (isRecord(migrated.chordTrack)) {
    if (!Array.isArray(migrated.chordTrack.cadenceAnnotations))
      migrated.chordTrack.cadenceAnnotations = [];
    migrated.chordTrack.displayMode =
      migrated.chordTrack.displayMode === "both"
        ? "roman-absolute"
        : migrated.chordTrack.displayMode;
  }
  if (!isRecord(migrated.loop) && isInteger(migrated.lengthTicks, 1)) {
    migrated.loop = {
      enabled: false,
      startTick: 0,
      endTick: Math.min(migrated.lengthTicks as number, PPQ * 4),
    };
  }
  if (
    isRecord(migrated.chordTrack) &&
    Array.isArray(migrated.chordTrack.regions)
  ) {
    migrated.chordTrack.regions = migrated.chordTrack.regions.map((region) => {
      if (!isRecord(region)) return region;
      const draft = migrateLegacyChordDraft(region.analysis);
      if (!draft || !isInteger(region.startTick, 0)) return region;
      const key = legacyKeyAtTick(typedKeyEvents, region.startTick as number);
      const next = { ...region };
      delete next.analysis;
      return {
        ...next,
        identity: resolveChordIdentity(draft, key),
        semantics: semanticsFromChordDraft(draft),
      };
    });
  }
  return migrated;
}

export function migrateProject(value: unknown): ProjectDocument | undefined {
  if (validateProject(value)) return normalizeProject(value);
  // schema v3 工程在引入乐句结构前没有 structure 字段；补充空结构后
  // 仍按当前模型完整校验，避免在各个读取入口重复做兼容分支。
  if (isRecord(value) && value.schemaVersion === PROJECT_SCHEMA_VERSION) {
    const upgraded = structuredClone(value);
    if (!isRecord(upgraded.structure))
      upgraded.structure = { phraseBoundaries: [] };
    if (isRecord(upgraded.chordTrack) && !Array.isArray(upgraded.chordTrack.cadenceAnnotations))
      upgraded.chordTrack.cadenceAnnotations = [];
    if (validateProject(upgraded))
      return normalizeProject(upgraded as unknown as ProjectDocument);
  }
  if (!isRecord(value) || value.schemaVersion !== 2) return undefined;
  const migrated = migrateV2Project(value);
  if (!migrated || !validateProject(migrated)) return undefined;
  return normalizeProject(migrated);
}
