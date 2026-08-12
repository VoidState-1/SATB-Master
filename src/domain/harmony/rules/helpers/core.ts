import { formatChordIdentity } from "../../../chords";
import { chordIdentityInversion } from "../../../chordModel";
import type {
  AnalysisChord,
  AnalysisNote,
  HarmonyAnalysis,
} from "../../analysis";
import type {
  DiagnosticEvidence,
  DiagnosticSubjects,
  DiagnosticTraceEntry,
  RuleDiagnostic,
  RuleEvaluation,
} from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_CONFIG, VOICE_ORDER } from "../../../project/voice";
import {
  formatSpelledPitch,
  pitchClassEquals,
  type SpelledPitchClass,
  type WrittenInterval,
} from "../../../pitch";

/** 将规则诊断数组封装为 RuleEvaluation 对象 */
export function evaluation(diagnostics: RuleDiagnostic[]): RuleEvaluation {
  return { diagnostics };
}

/** 构造标准化、结构化的 RuleDiagnostic 规则诊断对象 */
export function diagnostic(
  ruleId: string,
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
    subjects?: DiagnosticSubjects;
    trace?: DiagnosticTraceEntry[];
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
    subjects: options.subjects,
    trace: options.trace,
  };
}

/** 将半音值归一化为 [0, 11] 范围内的音高类 */
export function pitchClass(value: number) {
  return ((value % 12) + 12) % 12;
}

/** 将音程半音差归一化为 [0, 11] 范围内的模 12 音程 */
export function intervalMod12(value: number) {
  return ((value % 12) + 12) % 12;
}

/** 判断拼写音程是否为指定半音数的五度音程（自然音阶距离为 4） */
export function isWrittenFifth(interval: WrittenInterval, semitones: number) {
  return (
    Math.abs(interval.diatonicSteps) % 7 === 4 &&
    intervalMod12(interval.semitones) === semitones
  );
}

/** 判断拼写音程是否为纯五度（7个半音） */
export function isPerfectFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 7);
}

/** 判断拼写音程是否为减五度（6个半音） */
export function isDiminishedFifth(interval: WrittenInterval) {
  return isWrittenFifth(interval, 6);
}

/** 获取和弦的罗马数字名称标签 */
export function chordLabel(chord: AnalysisChord) {
  return formatChordIdentity(
    chord.identity as Parameters<typeof formatChordIdentity>[0],
    chord.semantics as Parameters<typeof formatChordIdentity>[1],
  ).roman;
}

/** 获取特定声部的轨道显示名称或默认配置名称 */
export function voiceName(analysis: HarmonyAnalysis, voiceId: VoiceId) {
  return (
    analysis.project.satbTracks.find((track) => track.id === voiceId)?.name ??
    VOICE_CONFIG[voiceId].name
  );
}

/** 生成音符维度的诊断悬停证据对象 */
export function noteEvidence(
  note: AnalysisNote,
  label = "音符",
): DiagnosticEvidence {
  return {
    kind: "note",
    id: note.id,
    label,
    value: formatSpelledPitch(note.pitch),
  };
}

/** 生成和弦维度的诊断悬停证据对象 */
export function chordEvidence(chord: AnalysisChord): DiagnosticEvidence {
  return {
    kind: "chord",
    id: chord.id,
    label: "和弦",
    value: chordLabel(chord),
  };
}

/** 将拼写音程转换为可读的中文名称（如“纯5度”、“小3度”）及增减标记 */
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

/** 判断音符的书写音高是否与给定的音高类集合中的某一个相等 */
export function hasExactPitch(
  note: AnalysisNote,
  spellings: readonly SpelledPitchClass[],
) {
  return spellings.some((tone) => pitchClassEquals(note.pitch, tone));
}

/** 按照声部顺序提取切片中所有活跃（非休止）的音符 */
export function activeNotes(slice: HarmonyAnalysis["slices"][number]) {
  return VOICE_ORDER.map((voiceId) => ({
    voiceId,
    note: slice.notes[voiceId],
  })).filter((item): item is { voiceId: VoiceId; note: AnalysisNote } =>
    Boolean(item.note),
  );
}

/** 计算和弦的转位状态（0为原位，1为第一转位，依此类推） */
export function chordInversion(chord: AnalysisChord) {
  return chordIdentityInversion(
    chord.identity as Parameters<typeof chordIdentityInversion>[0],
  );
}
