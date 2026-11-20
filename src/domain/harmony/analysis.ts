import {
  type ChordRegion,
  type HarmonySemantics,
  type KeyEvent,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../project/types";
import { VOICE_ORDER } from "../project/voice";
import {
  writtenInterval,
  type WrittenInterval,
} from "../pitch";
import {
  buildMetricTimeline,
  type MetricTimeline,
} from "../rhythm/metric";
import type { RuleDependencyScope } from "./rules/types";
import type {
  PhraseBoundary,
  PhraseBoundaryCandidate,
  PhraseSegment,
} from "./phrase";
import { detectCadences } from "./cadence";
import { cadenceInputs } from "./cadence/projectEvidence";
import { buildHarmonySpans, buildSlices, keyAtTick, sameKey } from "./segments";
import { reviewObservedCadenceAnnotation } from "./cadence/confirmation";
import type { CadenceCandidate } from "./cadence";
import type { CadenceAnnotation as ProjectCadenceAnnotation } from "../project/types";
import {
  buildHarmonyConnections,
  buildFunctionalTargetChains,
  type FunctionalTargetChainFact,
  type HarmonyConnectionAssessment,
} from "./rules/connector";
import {
  buildHarmonyContextFacts,
  type HarmonyContextFacts,
} from "./rules/sharedFacts";

import { readSliceProlongations, type WrittenProlongation } from "./writtenProlongation";

export { sameChordIdentityWithoutBass } from "./segments";

/** 递归深层只读类型映射，用于保证分析快照不可变 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** 深度只读的工程快照 */
export type ProjectSnapshot = DeepReadonly<ProjectDocument>;
/** 深度只读的音符事件 */
export type AnalysisNote = DeepReadonly<NoteEvent>;
/** 深度只读的和弦区域 */
export type AnalysisChord = DeepReadonly<ChordRegion>;
/** 深度只读的调号事件 */
export type AnalysisKey = DeepReadonly<KeyEvent>;

/**
 * 分析切片（AnalysisSlice）
 *
 * 在 SATB 音符起止、和弦区域起止、调号变更处切割形成的半开时间区间 [tick, endTick)。
 * 记录该区间内的活跃音符、本 tick 新起奏声部、当前调号与和弦。
 */
export interface AnalysisSlice {
  readonly index: number;
  readonly tick: number;
  readonly endTick: number;
  readonly notes: Readonly<Partial<Record<VoiceId, AnalysisNote>>>;
  readonly attackVoiceIds: readonly VoiceId[];
  readonly key: AnalysisKey;
  readonly chord?: AnalysisChord;
  readonly completeSatb: boolean;
  readonly continuity: "continuous" | "project-start";
}

/**
 * 旋律转换（MelodyTransition）
 *
 * 记录同一声部中连续两个起奏音符之间的转换事实（包含书写音程、是否连续、是否同调/同和声）。
 */
export interface MelodyTransition {
  readonly id: string;
  readonly voiceId: VoiceId;
  readonly previous: AnalysisNote;
  readonly current: AnalysisNote;
  readonly contiguous: boolean;
  readonly sameKey: boolean;
  readonly sameHarmony: boolean;
  readonly writtenInterval: WrittenInterval;
}

/**
 * 切片转换（SliceTransition）
 *
 * 记录连续两个分析切片之间的转换关系及发生变化的声部。
 */
export interface SliceTransition {
  readonly id: string;
  readonly previousIndex: number;
  readonly currentIndex: number;
  readonly previous: AnalysisSlice;
  readonly current: AnalysisSlice;
  /** 是否连续（不跨越项目起止或乐句） */
  readonly contiguous: boolean;
  /** 是否同调 */
  readonly sameKey: boolean;
  /** 是否同和弦（忽略低音与转位） */
  readonly sameHarmony: boolean;
  /** 本次转换中起奏并发生变化的声部 */
  readonly changedVoiceIds: readonly VoiceId[];
}

/**
 * 和声区段（HarmonySpan）
 *
 * 将时间上相连、调性相同、和弦实体一致（忽略低音与转位）且语义解释相同的切片聚合为连续区段。
 */
export interface HarmonySpan {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly regionIds: readonly string[];
  readonly sliceIndices: readonly number[];
  readonly identityKey: string;
  /** 和声学语意 */
  readonly semantics?: DeepReadonly<HarmonySemantics>;
  /** 标识当前和声区段的分析置信度与确定性 */
  readonly status: "complete" | "ambiguous";
  readonly entryTransitionIndex?: number;
  readonly exitTransitionIndex?: number;
}

/**
 * 分析失效范围（AnalysisInvalidationRange）
 *
 * 记录工程变更后受影响的 Tick 时间区间及依赖作用域（用于增量重检）。
 */
export interface AnalysisInvalidationRange {
  readonly fromTick: number;
  readonly toTick: number;
  readonly scopes: readonly RuleDependencyScope[];
}

/**
 * 和声分析快照（HarmonyAnalysis）
 *
 * 整合切片、Span、转换、连接评估与共享事实的完整只读分析上下文。
 */
export interface HarmonyAnalysis {
  readonly revision: number;
  readonly project: ProjectSnapshot;
  readonly metricTimeline: MetricTimeline;
  readonly phraseBoundaries: readonly PhraseBoundary[];
  readonly phraseBoundaryCandidates: readonly PhraseBoundaryCandidate[];
  readonly phraseSegments: readonly PhraseSegment[];
  readonly cadenceCandidates: readonly CadenceCandidate[];
  readonly cadenceAnnotations: readonly DeepReadonly<ProjectCadenceAnnotation>[];
  readonly cadenceAtTick: ReadonlyMap<
    number,
    CadenceCandidate | DeepReadonly<ProjectCadenceAnnotation>
  >;
  readonly slices: readonly AnalysisSlice[];
  readonly harmonySpans: readonly HarmonySpan[];
  readonly sliceSpanIds: ReadonlyMap<number, string>;
  readonly chordSpanIds: ReadonlyMap<string, readonly string[]>;
  readonly melodyTransitions: readonly MelodyTransition[];
  readonly sliceTransitions: readonly SliceTransition[];
  readonly connections: readonly HarmonyConnectionAssessment[];
  readonly writtenProlongations: ReadonlyMap<number, WrittenProlongation>;
  readonly targetChains: readonly FunctionalTargetChainFact[];
  readonly contextFacts: HarmonyContextFacts;
  readonly notesByVoice: Readonly<Record<VoiceId, readonly AnalysisNote[]>>;
  readonly noteById: ReadonlyMap<string, AnalysisNote>;
  readonly noteVoiceById: ReadonlyMap<string, VoiceId>;
  readonly chordById: ReadonlyMap<string, AnalysisChord>;
  readonly invalidationRanges: readonly AnalysisInvalidationRange[];
  readonly auxiliarySummary: {
    readonly trackCount: number;
    readonly noteCount: number;
  };
}

/** 递归深冻结对象，防止对象属性被突变 */
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.getOwnPropertyNames(value).forEach((key) => {
      const child = (value as Record<string, unknown>)[key];
      if (child && typeof child === "object") deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/**
 * 获取指定 Tick 处的有效和弦区域
 */
export function analysisChordAtTick(
  analysis: Pick<HarmonyAnalysis, "project">,
  tick: number,
) {
  return analysis.project.chordTrack.regions.find(
    (region) =>
      region.startTick <= tick &&
      region.startTick + region.durationTicks > tick,
  );
}

/**
 * 判断两个 Tick 处的和弦是否属于同一和声（调性、和弦实体与语义上下文均一致且连续）
 */
export function sameHarmonyAtTicks(
  analysis: Pick<HarmonyAnalysis, "project"> & Partial<Pick<HarmonyAnalysis, "harmonySpans">>,
  previousTick: number,
  currentTick: number,
) {
  const spans = analysis.harmonySpans ?? buildHarmonySpans(buildSlices(analysis.project).slices).harmonySpans;
  const start = Math.min(previousTick, currentTick);
  const end = Math.max(previousTick, currentTick);
  return spans.some(span => span.fromTick <= start && end < span.toTick);
}

function buildSliceTransitions(
  slices: readonly AnalysisSlice[],
  sliceSpanIds: ReadonlyMap<number, string>,
) {
  return Object.freeze(
    slices.slice(1).map((current, index) => {
      const previous = slices[index];
      const changedVoiceIds = VOICE_ORDER.filter(
        (voiceId) => previous.notes[voiceId]?.id !== current.notes[voiceId]?.id,
      );
      return {
        id: `slice-transition:${previous.index}->${current.index}`,
        previousIndex: index,
        currentIndex: current.index,
        previous,
        current,
        contiguous: previous.endTick === current.tick,
        sameKey: sameKey(previous.key, current.key),
        sameHarmony:
          Boolean(sliceSpanIds.get(previous.index)) &&
          sliceSpanIds.get(previous.index) === sliceSpanIds.get(current.index),
        changedVoiceIds: Object.freeze(changedVoiceIds),
      } satisfies SliceTransition;
    }),
  );
}

function buildMelodyTransitions(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans">,
  notesByVoice: Record<VoiceId, AnalysisNote[]>,
) {
  const transitions: MelodyTransition[] = [];
  VOICE_ORDER.forEach((voiceId) => {
    const notes = notesByVoice[voiceId];
    for (let index = 1; index < notes.length; index += 1) {
      const previous = notes[index - 1];
      const current = notes[index];
      const previousKey = keyAtTick(
        analysis.project.keyEvents,
        previous.startTick,
      );
      const currentKey = keyAtTick(
        analysis.project.keyEvents,
        current.startTick,
      );
      transitions.push({
        id: `melody-transition:${voiceId}:${previous.id}->${current.id}`,
        voiceId,
        previous,
        current,
        contiguous:
          previous.startTick + previous.durationTicks === current.startTick,
        sameKey: sameKey(previousKey, currentKey),
        sameHarmony: sameHarmonyAtTicks(
          analysis,
          previous.startTick,
          current.startTick,
        ),
        writtenInterval: writtenInterval(previous.pitch, current.pitch),
      });
    }
  });
  return Object.freeze(transitions);
}

function changeRange(
  fromTick: number,
  toTick: number,
  scopes: RuleDependencyScope[],
): AnalysisInvalidationRange {
  return {
    fromTick: Math.max(0, fromTick),
    toTick: Math.max(fromTick + 1, toTick),
    scopes,
  };
}

function entitySignature(value: unknown) {
  return JSON.stringify(value);
}

/**
 * 对比新旧工程快照，计算增量重检的受影响 Tick 区间与依赖作用域（RuleDependencyScope）
 */
export function computeAnalysisInvalidationRanges(
  previous: ProjectSnapshot | undefined,
  current: ProjectSnapshot,
) {
  if (!previous) {
    return [
      changeRange(0, current.lengthTicks, [
        "note",
        "slice",
        "chord",
        "phrase",
        "project",
      ]),
    ];
  }

  const ranges: AnalysisInvalidationRange[] = [];
  const previousNotes = new Map(
    previous.satbTracks.flatMap((track) =>
      track.notes.map(
        (note) => [note.id, { note, voiceId: track.id }] as const,
      ),
    ),
  );
  const currentNotes = new Map(
    current.satbTracks.flatMap((track) =>
      track.notes.map(
        (note) => [note.id, { note, voiceId: track.id }] as const,
      ),
    ),
  );
  new Set([...previousNotes.keys(), ...currentNotes.keys()]).forEach((id) => {
    const beforeEntry = previousNotes.get(id);
    const afterEntry = currentNotes.get(id);
    const before = beforeEntry?.note;
    const after = afterEntry?.note;
    if (entitySignature(before) === entitySignature(after)) return;
    const starts = [before?.startTick, after?.startTick].filter(
      (tick): tick is number => tick !== undefined,
    );
    const ends = [
      before && before.startTick + before.durationTicks,
      after && after.startTick + after.durationTicks,
    ].filter((tick): tick is number => typeof tick === "number");
    const voiceId = afterEntry?.voiceId ?? beforeEntry!.voiceId;
    const contextNotes = [
      ...previous.satbTracks.find((track) => track.id === voiceId)!.notes,
      ...current.satbTracks.find((track) => track.id === voiceId)!.notes,
    ]
      .filter((note) => note.id !== id)
      .sort((left, right) => left.startTick - right.startTick);
    const changedStart = Math.min(...starts);
    const changedEnd = Math.max(...ends);
    const previousContext = contextNotes
      .filter((note) => note.startTick < changedStart)
      .at(-1);
    const nextContext = contextNotes.find(
      (note) => note.startTick >= changedEnd,
    );
    ranges.push(
      changeRange(
        Math.min(changedStart, previousContext?.startTick ?? changedStart),
        Math.max(
          changedEnd,
          nextContext
            ? nextContext.startTick + nextContext.durationTicks
            : changedEnd,
        ),
        ["note", "slice", "phrase"],
      ),
    );
  });

  const previousChords = new Map(
    previous.chordTrack.regions.map((region) => [region.id, region] as const),
  );
  const currentChords = new Map(
    current.chordTrack.regions.map((region) => [region.id, region] as const),
  );
  new Set([...previousChords.keys(), ...currentChords.keys()]).forEach((id) => {
    const before = previousChords.get(id);
    const after = currentChords.get(id);
    if (entitySignature(before) === entitySignature(after)) return;
    const starts = [before?.startTick, after?.startTick].filter(
      (tick): tick is number => tick !== undefined,
    );
    const ends = [
      before && before.startTick + before.durationTicks,
      after && after.startTick + after.durationTicks,
    ].filter((tick): tick is number => typeof tick === "number");
    const changedStart = Math.min(...starts);
    const changedEnd = Math.max(...ends);
    const contextChords = [
      ...previous.chordTrack.regions,
      ...current.chordTrack.regions,
    ]
      .filter((region) => region.id !== id)
      .sort((left, right) => left.startTick - right.startTick);
    const previousContext = contextChords
      .filter((region) => region.startTick < changedStart)
      .at(-1);
    const nextContext = contextChords.find(
      (region) => region.startTick >= changedEnd,
    );
    ranges.push(
      changeRange(
        Math.min(changedStart, previousContext?.startTick ?? changedStart),
        Math.max(
          changedEnd,
          nextContext
            ? nextContext.startTick + nextContext.durationTicks
            : changedEnd,
        ),
        ["slice", "chord", "phrase"],
      ),
    );
  });

  if (
    entitySignature(previous.keyEvents) !== entitySignature(current.keyEvents)
  ) {
    ranges.push(
      changeRange(0, current.lengthTicks, [
        "slice",
        "chord",
        "phrase",
        "project",
      ]),
    );
  }
  if (
    entitySignature(previous.meterEvents) !==
    entitySignature(current.meterEvents)
  ) {
    ranges.push(changeRange(0, current.lengthTicks, ["phrase", "project"]));
  }
  if (entitySignature(previous.structure) !== entitySignature(current.structure)) {
    ranges.push(changeRange(0, current.lengthTicks, ["phrase", "project"]));
  }
  if (previous.lengthTicks !== current.lengthTicks) {
    ranges.push(
      changeRange(
        Math.min(previous.lengthTicks, current.lengthTicks),
        Math.max(previous.lengthTicks, current.lengthTicks),
        ["slice", "phrase", "project"],
      ),
    );
  }

  if (ranges.length === 0) return [];
  const ordered = ranges.sort((left, right) => left.fromTick - right.fromTick);
  const merged: AnalysisInvalidationRange[] = [];
  ordered.forEach((range) => {
    const previousRange = merged.at(-1);
    if (!previousRange || range.fromTick > previousRange.toTick) {
      merged.push(range);
      return;
    }
    merged[merged.length - 1] = {
      fromTick: previousRange.fromTick,
      toTick: Math.max(previousRange.toTick, range.toTick),
      scopes: [...new Set([...previousRange.scopes, ...range.scopes])],
    };
  });
  return merged;
}

/**
 * 构建完整的和声分析快照（HarmonyAnalysis）
 *
 * 依次完成工程解构、时间切片离散化、Span 聚合、过渡计算、和弦连接评估、目标链识别与共享事实汇集。
 *
 * @param project 当前工程文档
 * @param revision 单调递增的版本号（用于校验异步分析结果时效性）
 * @param previousSnapshot 可选的上一次分析工程快照（用于计算增量失效范围）
 */
export function buildHarmonyAnalysis(
  project: ProjectDocument,
  revision = 0,
  previousSnapshot?: ProjectSnapshot,
): HarmonyAnalysis {
  // 调度器只向规则暴露冻结后的克隆，避免内置或未来外置规则意外改写编辑器状态。
  const snapshot = deepFreeze(structuredClone(project));
  const metricTimeline = buildMetricTimeline(snapshot);
  const inputs = cadenceInputs(snapshot);
  const { phraseAnalysis, slices, notesByVoice, harmonySpans, sliceSpanIds, chordSpanIds, chordById } = inputs;
  const noteById = new Map<string, AnalysisNote>();
  const noteVoiceById = new Map<string, VoiceId>();
  VOICE_ORDER.forEach((voiceId) =>
    notesByVoice[voiceId].forEach((note) => {
      noteById.set(note.id, note);
      noteVoiceById.set(note.id, voiceId);
    }),
  );
  const sliceTransitions = buildSliceTransitions(slices, sliceSpanIds);
  const melodyTransitions = buildMelodyTransitions(inputs, notesByVoice);
  const writtenProlongations = readSliceProlongations(slices, phraseAnalysis.boundaries.map(boundary => boundary.tick));
  const connections = buildHarmonyConnections({
    project: snapshot,
    harmonySpans,
    chordById,
  });
  const targetChains = buildFunctionalTargetChains({
    project: snapshot,
    harmonySpans,
    chordById,
    connections,
  });
  const contextFacts = buildHarmonyContextFacts({
    slices,
    harmonySpans,
    melodyTransitions,
    sliceTransitions,
    connections,
  });
  const cadenceCandidates = detectCadences(inputs);
  const saved = snapshot.chordTrack.cadenceAnnotations;
  const cadenceAnnotations = saved.some(item => item.observedLandingTick !== undefined)
    ? Object.freeze(saved.map(annotation => Object.freeze(reviewObservedCadenceAnnotation(annotation, cadenceCandidates))))
    : saved;
  const cadenceAtTick = new Map<
    number,
    CadenceCandidate | DeepReadonly<ProjectCadenceAnnotation>
  >();
  cadenceCandidates.forEach((candidate) =>
    cadenceAtTick.set(candidate.fromTick, candidate),
  );
  cadenceAnnotations.forEach((annotation) =>
    (annotation.observedLandingTick === undefined || !annotation.stale || !cadenceAtTick.has(annotation.fromTick)) &&
      cadenceAtTick.set(annotation.fromTick, annotation),
  );

  return Object.freeze({
    revision,
    project: snapshot,
    metricTimeline,
    phraseBoundaries: phraseAnalysis.boundaries,
    phraseBoundaryCandidates: phraseAnalysis.candidates,
    phraseSegments: phraseAnalysis.segments,
    cadenceCandidates,
    cadenceAnnotations,
    cadenceAtTick,
    slices,
    harmonySpans,
    sliceSpanIds,
    chordSpanIds,
    melodyTransitions,
    sliceTransitions,
    connections,
    writtenProlongations,
    targetChains,
    contextFacts,
    notesByVoice: Object.freeze(notesByVoice),
    noteById,
    noteVoiceById,
    chordById,
    invalidationRanges: Object.freeze(
      computeAnalysisInvalidationRanges(previousSnapshot, snapshot),
    ),
    auxiliarySummary: Object.freeze({
      trackCount: snapshot.auxiliaryTracks.length,
      noteCount: snapshot.auxiliaryTracks.reduce(
        (total, track) => total + track.notes.length,
        0,
      ),
    }),
  });
}
