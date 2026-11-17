import {
  createEmptyProject,
  migrateProject,
  normalizeProject,
  type ProjectDocument,
} from "../../project";
import type { RuleTestProjectFixture } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function currentFixtureEnvelope(
  value: Record<string, unknown>,
  title: string,
) {
  const base = createEmptyProject(title);
  const lengthTicks =
    typeof value.lengthTicks === "number"
      ? value.lengthTicks
      : base.lengthTicks;
  return {
    ...base,
    schemaVersion: value.schemaVersion,
    ppq: value.ppq,
    lengthTicks,
    tempoEvents: value.tempoEvents,
    meterEvents: value.meterEvents,
    keyEvents: value.keyEvents,
    structure: value.structure === undefined ? base.structure : value.structure,
    satbTracks: value.satbTracks,
    auxiliaryTracks: value.auxiliaryTracks,
    chordTrack: value.chordTrack,
    loop: {
      ...base.loop,
      endTick: Math.min(base.loop.endTick, lengthTicks),
    },
  };
}

function legacyFixtureEnvelope(
  value: Record<string, unknown>,
  title: string,
) {
  const base = createEmptyProject(title);
  return {
    id: base.id,
    title,
    author: "",
    notes: "",
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    schemaVersion: 2,
    ppq: value.ppq,
    lengthTicks: value.lengthTicks,
    tempoEvents: value.tempoEvents,
    meterEvents: value.meterEvents,
    keyEvents: value.keyEvents,
    tracks: value.tracks,
    chordTrack: value.chordTrack,
    exercise: base.exercise,
    audio: base.audio,
  };
}

export function materializeUnknownRuleTestProject(
  value: unknown,
  title: string,
): ProjectDocument | undefined {
  if (!isRecord(value)) return undefined;
  const envelope =
    value.schemaVersion === 2
      ? legacyFixtureEnvelope(value, title)
      : currentFixtureEnvelope(value, title);
  return migrateProject(envelope);
}

export function materializeRuleTestProject(
  fixture: RuleTestProjectFixture,
  title: string,
): ProjectDocument {
  const project = materializeUnknownRuleTestProject(fixture, title);
  if (!project) throw new Error("规则测试工程输入无效");
  return project;
}

export function dematerializeRuleTestProject(
  project: ProjectDocument,
): RuleTestProjectFixture {
  const normalized = normalizeProject(project);
  return structuredClone({
    schemaVersion: normalized.schemaVersion,
    ppq: normalized.ppq,
    lengthTicks: normalized.lengthTicks,
    tempoEvents: normalized.tempoEvents,
    meterEvents: normalized.meterEvents,
    keyEvents: normalized.keyEvents,
    structure: normalized.structure,
    satbTracks: normalized.satbTracks,
    auxiliaryTracks: normalized.auxiliaryTracks,
    chordTrack: normalized.chordTrack,
  });
}
