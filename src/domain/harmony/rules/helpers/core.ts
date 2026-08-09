import { formatChordIdentity } from "../../../chords";
import type {
  AnalysisChord,
  AnalysisNote,
  HarmonyAnalysis,
} from "../../analysis";
import type {
  DiagnosticEvidence,
  RuleDiagnostic,
  RuleEvaluation,
} from "../../runtime";
import type { HarmonyRuleId } from "../../ruleTypes";
import { VOICE_CONFIG, VOICE_ORDER, type VoiceId } from "../../../project";
import {
  formatSpelledPitch,
  pitchClassEquals,
  type SpelledPitchClass,
  type WrittenInterval,
} from "../../../pitch";

export function evaluation(diagnostics: RuleDiagnostic[]): RuleEvaluation {
  return { diagnostics };
}

export function diagnostic(
  ruleId: HarmonyRuleId,
  tick: number,
  endTick: number,
  voiceIds: VoiceId[],
  notes: readonly AnalysisNote[],
  title: string,
  message: string,
  options: {
    chordIds?: string[];
    messageKey?: string;
    params?: Record<string, string | number | boolean>;
    evidence?: DiagnosticEvidence[];
    confidence?: number;
    causeRefs?: string[];
    coverageRefs?: string[];
  } = {},
): RuleDiagnostic {
  return {
    ruleId,
    source: "builtin",
    tick,
    endTick,
    voiceIds,
    noteIds: notes.map((note) => note.id),
    chordIds: options.chordIds ?? [],
    title,
    message,
    messageKey: options.messageKey ?? ruleId,
    params: options.params ?? {},
    evidence: options.evidence ?? [],
    confidence: options.confidence ?? 1,
    causeRefs: options.causeRefs,
    coverageRefs: options.coverageRefs,
  };
}

export function pitchClass(value: number) {
  return ((value % 12) + 12) % 12;
}

export function direction(from: number, to: number) {
  return Math.sign(to - from);
}

export function intervalMod12(value: number) {
  return ((value % 12) + 12) % 12;
}

export function isWrittenFifth(interval: WrittenInterval, semitones: number) {
  return (
    Math.abs(interval.diatonicSteps) % 7 === 4 &&
    intervalMod12(interval.semitones) === semitones
  );
}

export function isPerfectFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 7);
}

export function isDiminishedFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 6);
}

export function chordLabel(chord: AnalysisChord) {
  return formatChordIdentity(
    chord.identity as Parameters<typeof formatChordIdentity>[0],
    chord.semantics as Parameters<typeof formatChordIdentity>[1],
  ).roman;
}

export function supportsTertianResolutionRules(chord: AnalysisChord | undefined) {
  if (!chord) return true;
  return (
    chord.identity.structure.kind === "tertian" &&
    !chord.identity.structure.extensions.some((extension) => extension >= 9) &&
    (!chord.semantics ||
      (chord.semantics.interpretations.length === 1 &&
        !chord.semantics.pedalContext))
  );
}

export function voiceName(analysis: HarmonyAnalysis, voiceId: VoiceId) {
  return (
    analysis.project.satbTracks.find((track) => track.id === voiceId)?.name ??
    VOICE_CONFIG[voiceId].name
  );
}

export function noteEvidence(note: AnalysisNote, label = "音符"): DiagnosticEvidence {
  return {
    kind: "note",
    id: note.id,
    label,
    value: formatSpelledPitch(note.pitch),
  };
}

export function chordEvidence(chord: AnalysisChord): DiagnosticEvidence {
  return {
    kind: "chord",
    id: chord.id,
    label: "和弦",
    value: chordLabel(chord),
  };
}

export function intervalName(interval: WrittenInterval) {
  const diatonic = Math.abs(interval.diatonicSteps);
  const semitones = Math.abs(interval.semitones);
  const simpleIndex = diatonic % 7;
  const octaveCount = Math.floor(diatonic / 7);
  const number = diatonic + 1;
  const baseSemitones = [0, 2, 4, 5, 7, 9, 11][simpleIndex] + octaveCount * 12;
  const difference = semitones - baseSemitones;
  const perfectClass = [0, 3, 4].includes(simpleIndex);
  const quality = perfectClass
    ? difference === 0
      ? "纯"
      : difference > 0
        ? "增"
        : "减"
    : difference === 0
      ? "大"
      : difference === -1
        ? "小"
        : difference > 0
          ? "增"
          : "减";
  return {
    number,
    quality,
    label: `${quality}${number}度`,
    altered: quality === "增" || quality === "减",
  };
}

export function hasExactPitch(
  note: AnalysisNote,
  spellings: readonly SpelledPitchClass[],
) {
  return spellings.some((tone) => pitchClassEquals(note.pitch, tone));
}

export function finalSameHarmonySlice(analysis: HarmonyAnalysis, sliceIndex: number) {
  const current = analysis.slices[sliceIndex];
  const next = analysis.slices[sliceIndex + 1];
  return Boolean(
    next &&
    current.chord &&
    next.chord &&
    analysis.sliceTransitions[sliceIndex]?.sameHarmony,
  );
}

export function activeNotes(slice: HarmonyAnalysis["slices"][number]) {
  return VOICE_ORDER.map((voiceId) => ({
    voiceId,
    note: slice.notes[voiceId],
  })).filter((item): item is { voiceId: VoiceId; note: AnalysisNote } =>
    Boolean(item.note),
  );
}
