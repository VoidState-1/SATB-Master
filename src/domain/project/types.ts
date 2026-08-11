import type {
  ChordIdentity,
  ChordVoicingPolicy,
  FunctionalDesignation,
  FunctionalFamily,
  FunctionalTarget,
  HarmonyInterpretation,
  HarmonySemantics,
  KeyReference,
  ScaleDegree,
  SemanticConfidence,
} from "../chordModel";
import type {
  RuleConfig,
  RuleExceptionPolicy,
  RuleInstanceSettings,
} from "../harmony/rules/types";
import type {
  Alteration,
  DiatonicStep,
  KeyMode,
  SpelledPitch,
  SpelledPitchClass,
} from "../pitch";

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
} from "../chordModel";
export type {
  Alteration,
  DiatonicStep,
  KeyMode,
  SpelledPitch,
  SpelledPitchClass,
} from "../pitch";

export const PROJECT_SCHEMA_VERSION = 3;
export const PPQ = 960;

export type VoiceId = "soprano" | "alto" | "tenor" | "bass";
export type TrackId = VoiceId | string;
export type NonChordToneRole =
  | "passing"
  | "neighbor"
  | "suspension"
  | "retardation"
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
  profileVersion: 2;
  catalogRevision: number;
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
