export const PROJECT_SCHEMA_VERSION = 2;
export const PPQ = 960;

export type VoiceId = "soprano" | "alto" | "tenor" | "bass";
export type KeyMode = "major" | "minor";
export type NonChordToneRole =
  | "passing"
  | "neighbor"
  | "suspension"
  | "appoggiatura"
  | "anticipation"
  | "escape"
  | "pedal"
  | "other";
export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant7"
  | "major7"
  | "minor7"
  | "halfDiminished7"
  | "diminished7";

export interface NoteEvent {
  id: string;
  startTick: number;
  durationTicks: number;
  midiNote: number;
  velocity: number;
  locked: boolean;
  nonChordToneRole?: NonChordToneRole;
}

export interface VoiceTrack {
  id: VoiceId;
  name: string;
  shortName: "S" | "A" | "T" | "B";
  notes: NoteEvent[];
  visible: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number;
  pan: number;
  program: number;
}

export interface TempoEvent {
  id: string;
  tick: number;
  bpm: number;
}

export interface MeterEvent {
  id: string;
  tick: number;
  numerator: number;
  denominator: 2 | 4 | 8 | 16;
}

export interface KeyEvent {
  id: string;
  tick: number;
  tonic: number;
  mode: KeyMode;
}

export interface ChordAnalysis {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  accidental: -2 | -1 | 0 | 1 | 2;
  quality: ChordQuality;
  inversion: 0 | 1 | 2 | 3;
  appliedToDegree?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface ChordRegion {
  id: string;
  startTick: number;
  durationTicks: number;
  analysis: ChordAnalysis;
  locked: boolean;
}

export interface ChordTrack {
  visible: boolean;
  locked: boolean;
  displayMode: "roman" | "absolute" | "both";
  regions: ChordRegion[];
}

export interface LoopSettings {
  enabled: boolean;
  startTick: number;
  endTick: number;
}

export interface EditableRange {
  id: string;
  voiceIds: VoiceId[];
  fromTick: number;
  toTick: number;
  editable: boolean;
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  title: string;
  author: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  ppq: typeof PPQ;
  lengthTicks: number;
  tempoEvents: TempoEvent[];
  meterEvents: MeterEvent[];
  keyEvents: KeyEvent[];
  tracks: VoiceTrack[];
  chordTrack: ChordTrack;
  loop: LoopSettings;
  exercise: {
    instructions: string;
    editableRanges: EditableRange[];
  };
  audio: {
    masterVolume: number;
    soundFont: {
      kind: "default" | "user";
      name: string;
      path?: string;
      hash?: string;
    };
  };
}

export const VOICE_ORDER: VoiceId[] = ["soprano", "alto", "tenor", "bass"];

export const VOICE_CONFIG: Record<
  VoiceId,
  {
    name: string;
    shortName: VoiceTrack["shortName"];
    min: number;
    max: number;
    color: string;
    darkColor: string;
  }
> = {
  soprano: {
    name: "女高音",
    shortName: "S",
    min: 60,
    max: 81,
    color: "#7552a3",
    darkColor: "#4f3671",
  },
  alto: {
    name: "女低音",
    shortName: "A",
    min: 55,
    max: 74,
    color: "#2d7a68",
    darkColor: "#1f5549",
  },
  tenor: {
    name: "男高音",
    shortName: "T",
    min: 48,
    max: 67,
    color: "#3f6fa8",
    darkColor: "#2b4f79",
  },
  bass: {
    name: "男低音",
    shortName: "B",
    min: 40,
    max: 60,
    color: "#87643d",
    darkColor: "#60472b",
  },
};

export const KEY_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createTrack(id: VoiceId, program: number): VoiceTrack {
  const config = VOICE_CONFIG[id];
  return {
    id,
    name: config.name,
    shortName: config.shortName,
    notes: [],
    visible: true,
    muted: false,
    solo: false,
    locked: false,
    volume: 0.82,
    pan:
      id === "soprano"
        ? 0.2
        : id === "alto"
          ? 0.08
          : id === "tenor"
            ? -0.08
            : -0.2,
    program,
  };
}

export function createEmptyProject(title = "未命名练习"): ProjectDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId("project"),
    title,
    author: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
    ppq: PPQ,
    lengthTicks: PPQ * 4 * 16,
    tempoEvents: [{ id: createId("tempo"), tick: 0, bpm: 80 }],
    meterEvents: [
      { id: createId("meter"), tick: 0, numerator: 4, denominator: 4 },
    ],
    keyEvents: [{ id: createId("key"), tick: 0, tonic: 0, mode: "major" }],
    tracks: [
      createTrack("soprano", 52),
      createTrack("alto", 52),
      createTrack("tenor", 52),
      createTrack("bass", 53),
    ],
    chordTrack: {
      visible: true,
      locked: false,
      displayMode: "roman",
      regions: [],
    },
    loop: {
      enabled: false,
      startTick: 0,
      endTick: PPQ * 4,
    },
    exercise: { instructions: "", editableRanges: [] },
    audio: {
      masterVolume: 0.78,
      soundFont: { kind: "default", name: "SATB Master 默认音色" },
    },
  };
}

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

export function getTrack(project: ProjectDocument, voiceId: VoiceId) {
  const track = project.tracks.find((item) => item.id === voiceId);
  if (!track) throw new Error(`工程缺少声部：${voiceId}`);
  return track;
}

export function normalizeProject(project: ProjectDocument): ProjectDocument {
  const normalized = cloneProject(project);
  if (!normalized.loop) {
    normalized.loop = {
      enabled: false,
      startTick: 0,
      endTick: Math.min(normalized.lengthTicks, normalized.ppq * 4),
    };
  } else {
    const maximumStartTick = Math.max(0, normalized.lengthTicks - 1);
    const startTick = Math.max(
      0,
      Math.min(maximumStartTick, Math.round(normalized.loop.startTick)),
    );
    const endTick = Math.max(
      startTick + 1,
      Math.min(normalized.lengthTicks, Math.round(normalized.loop.endTick)),
    );
    normalized.loop = {
      enabled: normalized.loop.enabled,
      startTick,
      endTick,
    };
  }
  normalized.tempoEvents.sort((a, b) => a.tick - b.tick);
  normalized.meterEvents.sort((a, b) => a.tick - b.tick);
  normalized.keyEvents.sort((a, b) => a.tick - b.tick);
  normalized.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
  normalized.tracks.forEach((track) =>
    track.notes.sort(
      (a, b) => a.startTick - b.startTick || a.midiNote - b.midiNote,
    ),
  );
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return (
    Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isNumber(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function hasString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string";
}

function validateNote(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    isInteger(value.startTick, 0) &&
    isInteger(value.durationTicks, 1) &&
    isInteger(value.midiNote, 0, 127) &&
    isInteger(value.velocity, 1, 127) &&
    typeof value.locked === "boolean" &&
    (value.nonChordToneRole === undefined ||
      nonChordToneRoles.has(value.nonChordToneRole as NonChordToneRole))
  );
}

const chordQualities = new Set<ChordQuality>([
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "major7",
  "minor7",
  "halfDiminished7",
  "diminished7",
]);

const nonChordToneRoles = new Set<NonChordToneRole>([
  "passing",
  "neighbor",
  "suspension",
  "appoggiatura",
  "anticipation",
  "escape",
  "pedal",
  "other",
]);

function validateTrack(value: unknown) {
  if (
    !isRecord(value) ||
    !VOICE_ORDER.includes(value.id as VoiceId) ||
    !Array.isArray(value.notes)
  )
    return false;
  return (
    hasString(value, "name") &&
    ["S", "A", "T", "B"].includes(value.shortName as string) &&
    value.notes.every(validateNote) &&
    ["visible", "muted", "solo", "locked"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    isNumber(value.volume, 0, 1) &&
    isNumber(value.pan, -1, 1) &&
    isInteger(value.program, 0, 127)
  );
}

function validateChordAnalysis(value: unknown) {
  if (!isRecord(value)) return false;
  const inversionLimit = [
    "dominant7",
    "major7",
    "minor7",
    "halfDiminished7",
    "diminished7",
  ].includes(value.quality as string)
    ? 3
    : 2;
  return (
    isInteger(value.degree, 1, 7) &&
    isInteger(value.accidental, -2, 2) &&
    chordQualities.has(value.quality as ChordQuality) &&
    isInteger(value.inversion, 0, inversionLimit) &&
    (value.appliedToDegree === undefined ||
      isInteger(value.appliedToDegree, 1, 7))
  );
}

function validateChordRegion(value: unknown, projectLength: number) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    isInteger(value.startTick, 0) &&
    isInteger(value.durationTicks, 1) &&
    (value.startTick as number) + (value.durationTicks as number) <=
      projectLength &&
    validateChordAnalysis(value.analysis) &&
    typeof value.locked === "boolean"
  );
}

export function validateProject(value: unknown): value is ProjectDocument {
  if (!isRecord(value)) return false;
  const project = value;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.ppq !== PPQ)
    return false;
  if (
    !["id", "title", "author", "notes", "createdAt", "updatedAt"].every((key) =>
      hasString(project, key),
    )
  )
    return false;
  if (!isInteger(project.lengthTicks, 1)) return false;

  if (
    !Array.isArray(project.tracks) ||
    project.tracks.length !== VOICE_ORDER.length ||
    !project.tracks.every(validateTrack)
  )
    return false;
  const trackIds = new Set(
    project.tracks.map((track) => (track as Record<string, unknown>).id),
  );
  if (!VOICE_ORDER.every((voiceId) => trackIds.has(voiceId))) return false;

  if (
    !Array.isArray(project.tempoEvents) ||
    project.tempoEvents.length === 0 ||
    !project.tempoEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isNumber(event.bpm, 1, 1000),
    )
  )
    return false;
  if (!project.tempoEvents.some((event) => isRecord(event) && event.tick === 0))
    return false;

  if (
    !Array.isArray(project.meterEvents) ||
    project.meterEvents.length === 0 ||
    !project.meterEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isInteger(event.numerator, 1, 32) &&
        [2, 4, 8, 16].includes(event.denominator as number),
    )
  )
    return false;
  if (!project.meterEvents.some((event) => isRecord(event) && event.tick === 0))
    return false;

  if (
    !Array.isArray(project.keyEvents) ||
    project.keyEvents.length === 0 ||
    !project.keyEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isInteger(event.tonic, 0, 11) &&
        (event.mode === "major" || event.mode === "minor"),
    )
  )
    return false;
  if (!project.keyEvents.some((event) => isRecord(event) && event.tick === 0))
    return false;
  if (
    !isRecord(project.chordTrack) ||
    typeof project.chordTrack.visible !== "boolean" ||
    typeof project.chordTrack.locked !== "boolean" ||
    !["roman", "absolute", "both"].includes(
      project.chordTrack.displayMode as string,
    ) ||
    !Array.isArray(project.chordTrack.regions) ||
    !project.chordTrack.regions.every((region) =>
      validateChordRegion(region, project.lengthTicks as number),
    )
  )
    return false;
  if (
    !isRecord(project.loop) ||
    typeof project.loop.enabled !== "boolean" ||
    !isInteger(project.loop.startTick, 0, project.lengthTicks as number) ||
    !isInteger(project.loop.endTick, 1, project.lengthTicks as number) ||
    (project.loop.endTick as number) <= (project.loop.startTick as number)
  )
    return false;
  const orderedChords = [...project.chordTrack.regions].sort(
    (a, b) => (a as ChordRegion).startTick - (b as ChordRegion).startTick,
  ) as ChordRegion[];
  if (
    orderedChords.some(
      (region, index) =>
        index > 0 &&
        orderedChords[index - 1].startTick +
          orderedChords[index - 1].durationTicks >
          region.startTick,
    )
  )
    return false;

  if (
    !isRecord(project.exercise) ||
    typeof project.exercise.instructions !== "string" ||
    !Array.isArray(project.exercise.editableRanges)
  )
    return false;
  if (
    !project.exercise.editableRanges.every(
      (range) =>
        isRecord(range) &&
        hasString(range, "id") &&
        Array.isArray(range.voiceIds) &&
        range.voiceIds.every((voiceId) =>
          VOICE_ORDER.includes(voiceId as VoiceId),
        ) &&
        isInteger(range.fromTick, 0) &&
        isInteger(range.toTick, 1) &&
        (range.toTick as number) > (range.fromTick as number) &&
        typeof range.editable === "boolean",
    )
  )
    return false;

  if (
    !isRecord(project.audio) ||
    !isNumber(project.audio.masterVolume, 0, 1) ||
    !isRecord(project.audio.soundFont)
  )
    return false;
  const soundFont = project.audio.soundFont;
  if (
    (soundFont.kind !== "default" && soundFont.kind !== "user") ||
    typeof soundFont.name !== "string"
  )
    return false;
  if (soundFont.path !== undefined && typeof soundFont.path !== "string")
    return false;
  if (soundFont.hash !== undefined && typeof soundFont.hash !== "string")
    return false;
  return true;
}

export function migrateProject(value: unknown): ProjectDocument | undefined {
  if (validateProject(value)) return normalizeProject(value);
  if (
    isRecord(value) &&
    value.schemaVersion === PROJECT_SCHEMA_VERSION &&
    !isRecord(value.loop) &&
    isInteger(value.lengthTicks, 1)
  ) {
    const legacy = structuredClone(value) as Record<string, unknown>;
    legacy.loop = {
      enabled: false,
      startTick: 0,
      endTick: Math.min(value.lengthTicks as number, PPQ * 4),
    };
    if (validateProject(legacy)) return normalizeProject(legacy);
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.chords)
  )
    return undefined;

  const migrated = structuredClone(value) as Record<string, unknown>;
  const regions = value.chords.map((candidate) => {
    if (!isRecord(candidate)) return candidate;
    return {
      id: candidate.id,
      startTick: candidate.startTick,
      durationTicks: candidate.durationTicks,
      analysis: {
        degree: candidate.degree,
        accidental: candidate.accidental,
        quality: candidate.quality,
        inversion: candidate.inversion,
      },
      locked: candidate.locked,
    };
  });

  // v1 的 label 是可自由编辑的重复信息；迁移后名称统一由结构和调性重新计算。
  migrated.schemaVersion = PROJECT_SCHEMA_VERSION;
  migrated.chordTrack = {
    visible: true,
    locked: false,
    displayMode: "roman",
    regions,
  };
  delete migrated.chords;
  if (!isRecord(migrated.loop) && isInteger(migrated.lengthTicks, 1)) {
    migrated.loop = {
      enabled: false,
      startTick: 0,
      endTick: Math.min(migrated.lengthTicks as number, PPQ * 4),
    };
  }
  if (!validateProject(migrated)) return undefined;
  return normalizeProject(migrated);
}
