import {
  chordDraftFromIdentity,
  harmonySemanticsCompatibleWithIdentity,
  isSeventhChord,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordExtension,
  type ChordIdentity,
  type ChordQuality,
  type ChordToneAlteration,
  type ChordStructure,
  type ChordVoicingPolicy,
  type FunctionalDesignation,
  type FunctionalFamily,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type HarmonySemantics,
  type KeyReference,
  type ScaleDegree,
  type SemanticConfidence,
} from "./chordModel";
import {
  RULE_EXCEPTION_CONTEXTS,
  type RuleConfig,
  type RuleExceptionPolicy,
  type RuleInstanceSettings,
} from "./harmonyRules";
import {
  formatPitchClass,
  isSupportedKeySignature,
  legacyTonicSpelling,
  LEGACY_TONIC_SPELLINGS,
  spellMidi,
  toMidi,
  type Alteration,
  type DiatonicStep,
  type KeyMode,
  type SpelledPitch,
  type SpelledPitchClass,
} from "./pitch";

export type {
  ChordDraft,
  ChordExtension,
  ChordIdentity,
  ChordQuality,
  ChordStructure,
  ChordToneAlteration,
  ChordVoicingPolicy,
  FunctionalDesignation,
  FunctionalFamily,
  FunctionalTarget,
  HarmonyInterpretation,
  HarmonySemantics,
  KeyReference,
  ScaleDegree,
  SemanticConfidence,
} from "./chordModel";
export type {
  Alteration,
  DiatonicStep,
  KeyMode,
  SpelledPitch,
  SpelledPitchClass,
} from "./pitch";

export const PROJECT_SCHEMA_VERSION = 3;
export const PPQ = 960;

export type VoiceId = "soprano" | "alto" | "tenor" | "bass";
export type TrackId = VoiceId | string;
export type NonChordToneRole =
  | "passing"
  | "neighbor"
  | "suspension"
  | "appoggiatura"
  | "anticipation"
  | "escape"
  | "pedal"
  | "other";

export interface MidiImportOrigin {
  importId: string;
  sourceTrack: number;
  channel: number;
  sourceStartTick: number;
  sourceDurationTicks: number;
  sourceMidiNote: number;
}

export interface NoteEvent {
  id: string;
  startTick: number;
  durationTicks: number;
  pitch: SpelledPitch;
  velocity: number;
  locked: boolean;
  spellingSource: "manual" | "migrated" | "midi-inferred";
  nonChordToneRole?: NonChordToneRole;
  importOrigin?: MidiImportOrigin;
}

interface TrackBase {
  id: string;
  name: string;
  shortName: string;
  notes: NoteEvent[];
  visible: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number;
  pan: number;
  program: number;
}

export interface SatbTrack extends TrackBase {
  id: VoiceId;
  kind: "satb";
  voice: VoiceId;
  shortName: "S" | "A" | "T" | "B";
  participatesInHarmony: true;
  monophonic: true;
}

export interface AuxiliaryTrack extends TrackBase {
  kind: "auxiliary";
  role: "midi-import" | "reference" | "other";
  participatesInHarmony: false;
  monophonic: false;
}

export type VoiceTrack = SatbTrack;
export type MusicalTrack = SatbTrack | AuxiliaryTrack;

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
  tonic: SpelledPitchClass;
  mode: KeyMode;
}

export interface ChordRegion {
  id: string;
  startTick: number;
  durationTicks: number;
  identity: ChordIdentity;
  semantics?: HarmonySemantics;
  locked: boolean;
}

export interface ChordTrack {
  visible: boolean;
  locked: boolean;
  displayMode:
    | "functional"
    | "roman"
    | "absolute"
    | "functional-absolute"
    | "roman-absolute";
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

export type DiagnosticSeverity = "error" | "warning" | "suggestion";
export type HarmonyRuleSeverity = DiagnosticSeverity | "off";

export interface SharedHarmonySettings {
  voiceRanges: Record<VoiceId, { minMidi: number; maxMidi: number }>;
  strictFourPartTexture: boolean;
}

export interface ExternalRuleReferenceV3 {
    ruleId: string;
    packageId: string;
    version: string;
    contentHash: string;
    severity: HarmonyRuleSeverity;
    enabled: boolean;
    configVersion: number;
    config: RuleConfig;
    exceptions: RuleExceptionPolicy;
}

export interface RuleProfile {
  profileVersion: 1;
  title: string;
  shared: SharedHarmonySettings;
  builtin: Record<string, RuleInstanceSettings>;
  external: ExternalRuleReferenceV3[];
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
  satbTracks: SatbTrack[];
  auxiliaryTracks: AuxiliaryTrack[];
  chordTrack: ChordTrack;
  loop: LoopSettings;
  ruleProfile: RuleProfile;
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
    shortName: SatbTrack["shortName"];
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

// 仅供 v2 文件迁移与旧测试摘要使用；v3 的 KeyEvent 直接保存拼写。
export const KEY_NAMES = LEGACY_TONIC_SPELLINGS.map(formatPitchClass);

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createTrack(id: VoiceId, program: number): SatbTrack {
  const config = VOICE_CONFIG[id];
  return {
    id,
    kind: "satb",
    voice: id,
    name: config.name,
    shortName: config.shortName,
    notes: [],
    participatesInHarmony: true,
    monophonic: true,
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

export function createDefaultRuleProfile(): RuleProfile {
  return {
    profileVersion: 1,
    title: "斯波索宾基础规则",
    shared: {
      voiceRanges: {
        soprano: { minMidi: 60, maxMidi: 81 },
        alto: { minMidi: 55, maxMidi: 74 },
        tenor: { minMidi: 48, maxMidi: 67 },
        bass: { minMidi: 40, maxMidi: 60 },
      },
      strictFourPartTexture: false,
    },
    builtin: {},
    external: [],
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
    keyEvents: [
      {
        id: createId("key"),
        tick: 0,
        tonic: { step: "C", alter: 0 },
        mode: "major",
      },
    ],
    satbTracks: [
      createTrack("soprano", 52),
      createTrack("alto", 52),
      createTrack("tenor", 52),
      createTrack("bass", 53),
    ],
    auxiliaryTracks: [],
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
    ruleProfile: createDefaultRuleProfile(),
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

export function getSatbTrack(project: ProjectDocument, voiceId: VoiceId) {
  const track = project.satbTracks.find((item) => item.id === voiceId);
  if (!track) throw new Error(`工程缺少声部：${voiceId}`);
  return track;
}

export const getTrack = getSatbTrack;

export function getAllPlayableTracks(project: ProjectDocument) {
  return [...project.satbTracks, ...project.auxiliaryTracks];
}

export function getMusicalTrack(project: ProjectDocument, trackId: string) {
  const track = getAllPlayableTracks(project).find(
    (item) => item.id === trackId,
  );
  if (!track) throw new Error(`工程缺少轨道：${trackId}`);
  return track;
}

export function reconcileChordIdentities(project: ProjectDocument) {
  project.chordTrack.regions = project.chordTrack.regions.map((region) => {
    if (!region.semantics) return region;
    const key = [...project.keyEvents]
      .sort((left, right) => left.tick - right.tick)
      .filter((event) => event.tick <= region.startTick)
      .at(-1);
    return key
      ? {
          ...region,
          identity: resolveChordIdentity(
            chordDraftFromIdentity(region.identity, region.semantics),
            key,
          ),
        }
      : region;
  });
  return project;
}

export function normalizeProject(project: ProjectDocument): ProjectDocument {
  const normalized = cloneProject(project);
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
  normalized.tempoEvents.sort((a, b) => a.tick - b.tick);
  normalized.meterEvents.sort((a, b) => a.tick - b.tick);
  normalized.keyEvents.sort((a, b) => a.tick - b.tick);
  // 调号编辑会改变其后功能和弦的书写实体；保存前统一收敛为同一事实来源。
  reconcileChordIdentities(normalized);
  normalized.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
  getAllPlayableTracks(normalized).forEach((track) =>
    track.notes.sort(
      (a, b) => a.startTick - b.startTick || toMidi(a.pitch) - toMidi(b.pitch),
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

function validatePitchClass(value: unknown): value is SpelledPitchClass {
  return (
    isRecord(value) &&
    ["C", "D", "E", "F", "G", "A", "B"].includes(value.step as string) &&
    isInteger(value.alter, -2, 2)
  );
}

function validatePitch(value: unknown): value is SpelledPitch {
  if (!isRecord(value) || !validatePitchClass(value)) return false;
  const pitch = value as unknown as SpelledPitch;
  return (
    isInteger(pitch.octave, -2, 9) && toMidi(pitch) >= 0 && toMidi(pitch) <= 127
  );
}

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

function validateImportOrigin(value: unknown) {
  return (
    isRecord(value) &&
    hasString(value, "importId") &&
    isInteger(value.sourceTrack, 0) &&
    isInteger(value.channel, 0, 15) &&
    isInteger(value.sourceStartTick, 0) &&
    isInteger(value.sourceDurationTicks, 1) &&
    isInteger(value.sourceMidiNote, 0, 127)
  );
}

function validateNote(value: unknown, projectLength: number) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    isInteger(value.startTick, 0) &&
    isInteger(value.durationTicks, 1) &&
    (value.startTick as number) + (value.durationTicks as number) <=
      projectLength &&
    validatePitch(value.pitch) &&
    isInteger(value.velocity, 1, 127) &&
    typeof value.locked === "boolean" &&
    ["manual", "migrated", "midi-inferred"].includes(
      value.spellingSource as string,
    ) &&
    (value.nonChordToneRole === undefined ||
      nonChordToneRoles.has(value.nonChordToneRole as NonChordToneRole)) &&
    (value.importOrigin === undefined ||
      validateImportOrigin(value.importOrigin))
  );
}

function validateTrackBase(
  value: Record<string, unknown>,
  projectLength: number,
) {
  return (
    hasString(value, "id") &&
    hasString(value, "name") &&
    hasString(value, "shortName") &&
    Array.isArray(value.notes) &&
    value.notes.every((note) => validateNote(note, projectLength)) &&
    ["visible", "muted", "solo", "locked"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    isNumber(value.volume, 0, 1) &&
    isNumber(value.pan, -1, 1) &&
    isInteger(value.program, 0, 127)
  );
}

function validateSatbTrack(value: unknown, projectLength: number) {
  if (!isRecord(value) || !validateTrackBase(value, projectLength))
    return false;
  return (
    value.kind === "satb" &&
    VOICE_ORDER.includes(value.id as VoiceId) &&
    value.voice === value.id &&
    ["S", "A", "T", "B"].includes(value.shortName as string) &&
    value.participatesInHarmony === true &&
    value.monophonic === true
  );
}

function validateAuxiliaryTrack(value: unknown, projectLength: number) {
  if (!isRecord(value) || !validateTrackBase(value, projectLength))
    return false;
  return (
    value.kind === "auxiliary" &&
    ["midi-import", "reference", "other"].includes(value.role as string) &&
    value.participatesInHarmony === false &&
    value.monophonic === false
  );
}

function validateKeyReference(value: unknown): value is KeyReference {
  return (
    isRecord(value) &&
    validatePitchClass(value.tonic) &&
    ["major", "minor"].includes(value.mode as string)
  );
}

const functionalFamilies = new Set<FunctionalFamily>([
  "tonic",
  "subdominant",
  "dominant",
]);

function validateFunctionalTarget(value: unknown): value is FunctionalTarget {
  return (
    isRecord(value) &&
    isInteger(value.degree, 1, 7) &&
    functionalFamilies.has(value.primaryFunction as FunctionalFamily) &&
    (value.secondaryFunction === undefined ||
      functionalFamilies.has(value.secondaryFunction as FunctionalFamily))
  );
}

function validateFunctionalDesignation(
  value: unknown,
): value is FunctionalDesignation {
  return (
    isRecord(value) &&
    value.notationSystem === "spasobin" &&
    [
      "primary",
      "side-degree",
      "applied-dominant",
      "applied-leading-tone",
      "double-dominant",
      "double-dominant-leading-tone",
      "cadential64",
      "neapolitan",
      "augmented-sixth",
      "altered-dominant",
    ].includes(value.kind as string) &&
    (value.primaryFunction === undefined ||
      functionalFamilies.has(value.primaryFunction as FunctionalFamily)) &&
    (value.secondaryFunction === undefined ||
      functionalFamilies.has(value.secondaryFunction as FunctionalFamily)) &&
    (value.specialRole === undefined ||
      ["neapolitan", "italian6", "french6", "german6"].includes(
        value.specialRole as string,
      ))
  );
}

function validateHarmonyInterpretation(
  value: unknown,
): value is HarmonyInterpretation {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    (value.id as string).length > 0 &&
    isInteger(value.degree, 1, 7) &&
    isInteger(value.degreeAlteration, -2, 2) &&
    ["manual", "inferred", "confirmed"].includes(value.source as string) &&
    ["certain", "probable", "ambiguous", "unknown"].includes(
      value.confidence as string,
    ) &&
    (value.localKey === undefined || validateKeyReference(value.localKey)) &&
    (value.appliedTarget === undefined ||
      validateFunctionalTarget(value.appliedTarget)) &&
    (value.designation === undefined ||
      validateFunctionalDesignation(value.designation))
  );
}

function validateHarmonySemantics(value: unknown): value is HarmonySemantics {
  if (
    !isRecord(value) ||
    !Array.isArray(value.interpretations) ||
    value.interpretations.length === 0 ||
    !value.interpretations.every(validateHarmonyInterpretation) ||
    typeof value.primaryInterpretationId !== "string"
  )
    return false;

  const alternatives = value.alternatives;
  if (
    alternatives !== undefined &&
    (!Array.isArray(alternatives) ||
      !alternatives.every(validateHarmonyInterpretation))
  )
    return false;

  const interpretations = value.interpretations as HarmonyInterpretation[];
  const allInterpretations = [
    ...interpretations,
    ...((alternatives ?? []) as HarmonyInterpretation[]),
  ];
  const ids = allInterpretations.map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    !interpretations.some(
      (item) => item.id === value.primaryInterpretationId,
    ) ||
    interpretations.filter((item) => item.source === "confirmed").length > 2
  )
    return false;

  return (
    (value.mixture === undefined ||
      ["parallel-major", "parallel-minor", "modal"].includes(
        value.mixture as string,
      )) &&
    (value.cadenceRole === undefined ||
      ["cadential64", "passing64", "pedal64", "deceptive"].includes(
        value.cadenceRole as string,
      )) &&
    (value.pedalContext === undefined ||
      (isRecord(value.pedalContext) &&
        validatePitchClass(value.pedalContext.pitch) &&
        ["start", "continue", "end"].includes(
          value.pedalContext.role as string,
        )))
  );
}

function validateChordIdentity(value: unknown): value is ChordIdentity {
  if (
    !isRecord(value) ||
    !validatePitchClass(value.root) ||
    !validatePitchClass(value.bass) ||
    !isRecord(value.structure)
  )
    return false;
  if (value.structure.kind === "augmented-sixth")
    return ["italian", "french", "german"].includes(
      value.structure.variant as string,
    );
  if (value.structure.kind !== "tertian") return false;
  return (
    chordQualities.has(value.structure.quality as ChordQuality) &&
    Array.isArray(value.structure.extensions) &&
    value.structure.extensions.every((extension) =>
      [6, 7, 9, 11, 13].includes(extension),
    ) &&
    new Set(value.structure.extensions).size ===
      value.structure.extensions.length &&
    Array.isArray(value.structure.alterations) &&
    value.structure.alterations.every(
      (alteration) =>
        isRecord(alteration) &&
        [5, 9, 11, 13].includes(alteration.degree as number) &&
        isInteger(alteration.alter, -2, 2) &&
        (alteration.tendency === undefined ||
          alteration.tendency === "up" ||
          alteration.tendency === "down"),
    ) &&
    new Set(
      value.structure.alterations.map(
        (alteration) => (alteration as ChordToneAlteration).degree,
      ),
    ).size === value.structure.alterations.length
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
    validateChordIdentity(value.identity) &&
    (value.semantics === undefined ||
      validateHarmonySemantics(value.semantics)) &&
    typeof value.locked === "boolean"
  );
}

function validateRuleProfile(value: unknown) {
  if (
    !isRecord(value) ||
    value.profileVersion !== 1 ||
    typeof value.title !== "string" ||
    value.title.length > 120 ||
    !isRecord(value.shared) ||
    !isRecord(value.builtin) ||
    !Array.isArray(value.external)
  )
    return false;
  if (
    value.external.length > 256 ||
    Object.keys(value.builtin).length > 256 ||
    !isRecord(value.shared)
  )
    return false;
  const shared = value.shared;
  if (
    typeof shared.strictFourPartTexture !== "boolean" ||
    !isRecord(shared.voiceRanges)
  )
    return false;
  const voiceRanges = shared.voiceRanges;
  const severities = ["error", "warning", "suggestion", "off"];
  const configValue = (item: unknown) =>
    typeof item === "string" ||
    typeof item === "boolean" ||
    (typeof item === "number" && Number.isFinite(item)) ||
    (isRecord(item) &&
      ((isInteger(item.minMidi, 0, 127) &&
        isInteger(item.maxMidi, 0, 127) &&
        (item.minMidi as number) <= (item.maxMidi as number)) ||
        (typeof item.value === "number" &&
          Number.isFinite(item.value) &&
          ["ticks", "beats", "measures"].includes(item.unit as string))));
  const config = (candidate: unknown) =>
    isRecord(candidate) &&
    Object.keys(candidate).length <= 64 &&
    Object.values(candidate).every(configValue);
  const exceptions = (candidate: unknown) =>
    isRecord(candidate) &&
    Object.keys(candidate).every((context) =>
      RULE_EXCEPTION_CONTEXTS.includes(
        context as (typeof RULE_EXCEPTION_CONTEXTS)[number],
      ),
    ) &&
    Object.values(candidate).every(
      (mode) =>
        typeof mode === "string" &&
        ["exempt", "downgrade", "strict"].includes(mode),
    );
  if (
    !VOICE_ORDER.every((voiceId) => {
      const range = voiceRanges[voiceId];
      return (
        isRecord(range) &&
        isInteger(range.minMidi, 0, 127) &&
        isInteger(range.maxMidi, 0, 127) &&
        (range.minMidi as number) <= (range.maxMidi as number)
      );
    })
  )
    return false;
  const ids = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
  const versions = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/;
  const hashes = /^[a-f0-9]{64}$/;
  if (
    !Object.entries(value.builtin).every(
      ([ruleId, settings]) =>
        ids.test(ruleId) &&
        isRecord(settings) &&
        severities.includes(settings.severity as string) &&
        isInteger(settings.configVersion, 1) &&
        config(settings.config) &&
        exceptions(settings.exceptions),
    )
  )
    return false;
  const references = new Set<string>();
  return value.external.every((rule) => {
    if (
      !isRecord(rule) ||
      typeof rule.ruleId !== "string" ||
      !ids.test(rule.ruleId) ||
      typeof rule.packageId !== "string" ||
      !ids.test(rule.packageId) ||
      typeof rule.version !== "string" ||
      !versions.test(rule.version) ||
      typeof rule.contentHash !== "string" ||
      !hashes.test(rule.contentHash) ||
      !severities.includes(rule.severity as string) ||
      typeof rule.enabled !== "boolean" ||
      !isInteger(rule.configVersion, 1) ||
      !config(rule.config) ||
      !exceptions(rule.exceptions)
    )
      return false;
    const key = `${rule.packageId}@${rule.version}:${rule.contentHash}:${rule.ruleId}`;
    if (references.has(key)) return false;
    references.add(key);
    return true;
  });
}

export function validateProject(value: unknown): value is ProjectDocument {
  if (!isRecord(value)) return false;
  const project = value;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.ppq !== PPQ)
    return false;
  if (
    !["id", "title", "author", "notes", "createdAt", "updatedAt"].every((key) =>
      hasString(project, key),
    ) ||
    !isInteger(project.lengthTicks, 1)
  )
    return false;

  if (
    !Array.isArray(project.satbTracks) ||
    project.satbTracks.length !== VOICE_ORDER.length ||
    !project.satbTracks.every((track) =>
      validateSatbTrack(track, project.lengthTicks as number),
    ) ||
    !Array.isArray(project.auxiliaryTracks) ||
    !project.auxiliaryTracks.every((track) =>
      validateAuxiliaryTrack(track, project.lengthTicks as number),
    )
  )
    return false;
  const voiceIds = new Set(
    project.satbTracks.map((track) => (track as Record<string, unknown>).id),
  );
  if (!VOICE_ORDER.every((voiceId) => voiceIds.has(voiceId))) return false;
  const allTrackIds = [...project.satbTracks, ...project.auxiliaryTracks].map(
    (track) => (track as Record<string, unknown>).id,
  );
  if (new Set(allTrackIds).size !== allTrackIds.length) return false;

  if (
    !Array.isArray(project.tempoEvents) ||
    project.tempoEvents.length === 0 ||
    !project.tempoEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        isNumber(event.bpm, 1, 1000),
    ) ||
    !project.tempoEvents.some((event) => isRecord(event) && event.tick === 0)
  )
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
    ) ||
    !project.meterEvents.some((event) => isRecord(event) && event.tick === 0)
  )
    return false;

  if (
    !Array.isArray(project.keyEvents) ||
    project.keyEvents.length === 0 ||
    !project.keyEvents.every(
      (event) =>
        isRecord(event) &&
        hasString(event, "id") &&
        isInteger(event.tick, 0) &&
        validatePitchClass(event.tonic) &&
        ["major", "minor"].includes(event.mode as string) &&
        isSupportedKeySignature(event as unknown as KeyEvent),
    ) ||
    !project.keyEvents.some((event) => isRecord(event) && event.tick === 0)
  )
    return false;

  if (
    !isRecord(project.chordTrack) ||
    typeof project.chordTrack.visible !== "boolean" ||
    typeof project.chordTrack.locked !== "boolean" ||
    ![
      "functional",
      "roman",
      "absolute",
      "functional-absolute",
      "roman-absolute",
    ].includes(
      project.chordTrack.displayMode as string,
    ) ||
    !Array.isArray(project.chordTrack.regions) ||
    !project.chordTrack.regions.every((region) =>
      validateChordRegion(region, project.lengthTicks as number),
    )
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
  for (const region of orderedChords) {
    if (!region.semantics) continue;
    const key = [...(project.keyEvents as KeyEvent[])]
      .sort((a, b) => a.tick - b.tick)
      .filter((event) => event.tick <= region.startTick)
      .at(-1);
    if (
      !key ||
      !harmonySemanticsCompatibleWithIdentity(
        region.identity,
        region.semantics,
        key,
      )
    )
      return false;
  }

  if (
    !isRecord(project.loop) ||
    typeof project.loop.enabled !== "boolean" ||
    !isInteger(project.loop.startTick, 0, project.lengthTicks as number) ||
    !isInteger(project.loop.endTick, 1, project.lengthTicks as number) ||
    (project.loop.endTick as number) <= (project.loop.startTick as number)
  )
    return false;

  if (!validateRuleProfile(project.ruleProfile)) return false;

  if (
    !isRecord(project.exercise) ||
    typeof project.exercise.instructions !== "string" ||
    !Array.isArray(project.exercise.editableRanges) ||
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
    typeof soundFont.name !== "string" ||
    (soundFont.path !== undefined && typeof soundFont.path !== "string") ||
    (soundFont.hash !== undefined && typeof soundFont.hash !== "string")
  )
    return false;
  return true;
}

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
  if (!isRecord(value) || value.schemaVersion !== 2) return undefined;
  const migrated = migrateV2Project(value);
  if (!migrated || !validateProject(migrated)) return undefined;
  return normalizeProject(migrated);
}
