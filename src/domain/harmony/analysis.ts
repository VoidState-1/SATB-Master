import {
  chordIdentityToneSpellings,
  harmonySemanticsConfidence,
} from "../chordModel";
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
  pitchClassEquals,
  writtenInterval,
  type WrittenInterval,
} from "../pitch";
import {
  buildMetricTimeline,
  type MetricTimeline,
} from "../rhythm/metric";
import type { RuleDependencyScope } from "./rules/types";
import { analyzePhrases } from "./phrase";
import type {
  PhraseBoundary,
  PhraseBoundaryCandidate,
  PhraseSegment,
} from "./phrase";
import { detectCadences } from "./cadence";
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
  readonly slices: readonly AnalysisSlice[];
  readonly harmonySpans: readonly HarmonySpan[];
  readonly sliceSpanIds: ReadonlyMap<number, string>;
  readonly chordSpanIds: ReadonlyMap<string, readonly string[]>;
  readonly melodyTransitions: readonly MelodyTransition[];
  readonly sliceTransitions: readonly SliceTransition[];
  readonly connections: readonly HarmonyConnectionAssessment[];
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

/** 内部辅助：查找指定 tick 处的有效调号事件 */
function keyAtTick(events: readonly AnalysisKey[], tick: number) {
  let current = events[0];
  for (const event of events) {
    if (event.tick > tick) break;
    current = event;
  }
  if (!current) throw new Error("和声分析至少需要一个位于起点的调号事件");
  return current;
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

/** 内部辅助：判断两个调号事件是否同调（主音与调式一致） */
function sameKey(left: AnalysisKey, right: AnalysisKey) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

/** 内部辅助：判断两个和弦的语义上下文是否相同 */
function sameSemanticContext(
  left: DeepReadonly<HarmonySemantics> | undefined,
  right: DeepReadonly<HarmonySemantics> | undefined,
) {
  if (!left || !right) return left === right;
  if (
    left.primaryInterpretationId !== right.primaryInterpretationId ||
    left.interpretations.length !== right.interpretations.length ||
    (left.alternatives?.length ?? 0) !== (right.alternatives?.length ?? 0)
  )
    return false;
  // Span 合并依赖完整语义而非粗粒度功能类别，目标、双重解释和持续低音变化都会切断 span。
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 判断两个和弦实体是否相同，忽略低音与转位。 */
export function sameChordIdentityWithoutBass(
  left: AnalysisChord["identity"],
  right: AnalysisChord["identity"],
) {
  if (
    JSON.stringify(left.structure) !== JSON.stringify(right.structure) ||
    !pitchClassEquals(left.root, right.root)
  )
    return false;
  const serializeTone = (tone: { step: string; alter: number }) =>
    `${tone.step}:${tone.alter}`;
  const leftTones = chordIdentityToneSpellings(left).map(serializeTone).sort();
  const rightTones = chordIdentityToneSpellings(right)
    .map(serializeTone)
    .sort();
  return (
    leftTones.length === rightTones.length &&
    leftTones.every((tone, index) => tone === rightTones[index])
  );
}

/** 内部辅助：判断两个和弦区域在时间轴上是否连续 */
function chordContinuity(previous: AnalysisChord, current: AnalysisChord) {
  return (
    previous.id === current.id ||
    previous.startTick + previous.durationTicks === current.startTick
  );
}

/**
 * 判断两个 Tick 处的和弦是否属于同一和声（调性、和弦实体与语义上下文均一致且连续）
 */
export function sameHarmonyAtTicks(
  analysis: Pick<HarmonyAnalysis, "project">,
  previousTick: number,
  currentTick: number,
) {
  const previousChord = analysisChordAtTick(analysis, previousTick);
  const currentChord = analysisChordAtTick(analysis, currentTick);
  if (!previousChord || !currentChord) return false;
  if (!chordContinuity(previousChord, currentChord)) return false;

  const previousKey = keyAtTick(analysis.project.keyEvents, previousTick);
  const currentKey = keyAtTick(analysis.project.keyEvents, currentTick);
  return (
    sameKey(previousKey, currentKey) &&
    sameChordIdentityWithoutBass(
      previousChord.identity,
      currentChord.identity,
    ) &&
    sameSemanticContext(previousChord.semantics, currentChord.semantics)
  );
}

/**
 * 按照所有音符、和弦、调号变更点分割时间轴为分析切片（AnalysisSlice）
 * 每个切片对应 [tick, endTick) 半开区间
 */
function buildSlices(project: ProjectSnapshot) {
  // 1. 提取关键时间边界
  const boundaries = new Set<number>([0, project.lengthTicks]);
  project.satbTracks.forEach((track) =>
    track.notes.forEach((note) => {
      boundaries.add(note.startTick);
      boundaries.add(note.startTick + note.durationTicks);
    }),
  );
  project.chordTrack.regions.forEach((region) => {
    boundaries.add(region.startTick);
    boundaries.add(region.startTick + region.durationTicks);
  });
  project.keyEvents.forEach((event) => boundaries.add(event.tick));

  // 2. 排序去重, 初始化游标
  const ordered = [...boundaries]
    .filter((tick) => tick >= 0 && tick <= project.lengthTicks)
    .sort((left, right) => left - right);
  const notesByVoice = Object.fromEntries(
    project.satbTracks.map((track) => [
      track.id,
      [...track.notes].sort(
        (left, right) =>
          left.startTick - right.startTick || left.id.localeCompare(right.id),
      ),
    ]),
  ) as Record<VoiceId, AnalysisNote[]>;
  const noteIndexes: Record<VoiceId, number> = {
    soprano: 0,
    alto: 0,
    tenor: 0,
    bass: 0,
  };
  const chords = [...project.chordTrack.regions].sort(
    (left, right) => left.startTick - right.startTick,
  );
  let chordIndex = 0;
  let keyIndex = 0;
  const slices: AnalysisSlice[] = [];

  // 3. 线性扫描切片
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const tick = ordered[index];
    // 3.1 跳过已经结束的和弦
    while (
      chordIndex < chords.length &&
      chords[chordIndex].startTick + chords[chordIndex].durationTicks <= tick
    )
      chordIndex += 1;
    // 3.2 跳过调号事件
    while (
      keyIndex + 1 < project.keyEvents.length &&
      project.keyEvents[keyIndex + 1].tick <= tick
    )
      keyIndex += 1;

    // 3.3 收集当前切片的音符
    const notes: Partial<Record<VoiceId, AnalysisNote>> = {};
    const attackVoiceIds: VoiceId[] = [];
    VOICE_ORDER.forEach((voiceId) => {
      const source = notesByVoice[voiceId];
      let noteIndex = noteIndexes[voiceId];
      // 3.3.1 跳过已经结束的音符
      while (
        noteIndex < source.length &&
        source[noteIndex].startTick + source[noteIndex].durationTicks <= tick
      )
        noteIndex += 1;
      noteIndexes[voiceId] = noteIndex;
      const note = source[noteIndex];
      // 3.3.2 找到正在持续的音符
      if (
        note &&
        note.startTick <= tick &&
        note.startTick + note.durationTicks > tick
      ) {
        notes[voiceId] = note;
        // 3.3.3 记录处于启奏状态的音符
        if (note.startTick === tick) attackVoiceIds.push(voiceId);
      }
    });

    // 3.4 封装切片
    const chord = chords[chordIndex];
    slices.push({
      index,
      tick,
      endTick: ordered[index + 1],
      notes: Object.freeze(notes),
      attackVoiceIds: Object.freeze(attackVoiceIds),
      key: project.keyEvents[keyIndex],
      chord:
        chord &&
        chord.startTick <= tick &&
        chord.startTick + chord.durationTicks > tick
          ? chord
          : undefined,
      completeSatb: VOICE_ORDER.every((voiceId) => Boolean(notes[voiceId])),
      continuity: index === 0 ? "project-start" : "continuous",
    });
  }

  return { slices: Object.freeze(slices), notesByVoice };
}

function chordIdentityKey(region: AnalysisChord) {
  const identity = region.identity;
  return JSON.stringify({
    root: identity.root,
    structure: identity.structure,
    tones: chordIdentityToneSpellings(identity),
  });
}

function buildHarmonySpans(
  _project: ProjectSnapshot,
  slices: readonly AnalysisSlice[],
) {
  const groups: AnalysisSlice[][] = [];
  slices.forEach((slice) => {
    if (!slice.chord) return;
    const previous = groups.at(-1)?.at(-1);
    const canJoin = Boolean(
      previous &&
      previous.chord &&
      previous.endTick === slice.tick &&
      sameKey(previous.key, slice.key) &&
      sameChordIdentityWithoutBass(
        previous.chord.identity,
        slice.chord.identity,
      ) &&
      sameSemanticContext(previous.chord.semantics, slice.chord.semantics),
    );
    if (canJoin) groups.at(-1)!.push(slice);
    else groups.push([slice]);
  });

  const sliceSpanIds = new Map<number, string>();
  const chordSpanIds = new Map<string, string[]>();
  const harmonySpans = groups.map((group, groupIndex) => {
    const id = `harmony-span-${groupIndex + 1}`;
    const regionIds = [
      ...new Set(
        group.flatMap((slice) => (slice.chord ? [slice.chord.id] : [])),
      ),
    ];
    const sliceIndices = group.map((slice) => slice.index);
    sliceIndices.forEach((index) => sliceSpanIds.set(index, id));
    regionIds.forEach((regionId) => {
      const spanIds = chordSpanIds.get(regionId) ?? [];
      spanIds.push(id);
      chordSpanIds.set(regionId, spanIds);
    });
    const firstSlice = group[0];
    const lastSlice = group.at(-1)!;
    const first = firstSlice.chord!;
    const semantics = first.semantics;
    const confidence = semantics
      ? harmonySemanticsConfidence(semantics)
      : "unknown";
    return {
      id,
      fromTick: firstSlice.tick,
      toTick: lastSlice.endTick,
      regionIds: Object.freeze(regionIds),
      sliceIndices: Object.freeze(sliceIndices),
      identityKey: chordIdentityKey(first),
      semantics,
      status:
        confidence === "ambiguous" || confidence === "unknown"
          ? "ambiguous"
          : "complete",
      entryTransitionIndex:
        sliceIndices.length > 0 && sliceIndices[0] > 0
          ? sliceIndices[0] - 1
          : undefined,
      exitTransitionIndex:
        sliceIndices.length > 0 && sliceIndices.at(-1)! < slices.length - 1
          ? sliceIndices.at(-1)
          : undefined,
    } satisfies HarmonySpan;
  });

  return {
    harmonySpans: Object.freeze(harmonySpans),
    sliceSpanIds,
    chordSpanIds: new Map(
      [...chordSpanIds].map(([regionId, spanIds]) => [
        regionId,
        Object.freeze([...spanIds]),
      ]),
    ),
  };
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
  analysis: Pick<HarmonyAnalysis, "project">,
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
  const phraseAnalysis = analyzePhrases(snapshot);
  const analysisShell = { project: snapshot } as Pick<
    HarmonyAnalysis,
    "project"
  >;
  const { slices, notesByVoice } = buildSlices(snapshot);
  const { harmonySpans, sliceSpanIds, chordSpanIds } = buildHarmonySpans(
    snapshot,
    slices,
  );
  const noteById = new Map<string, AnalysisNote>();
  const noteVoiceById = new Map<string, VoiceId>();
  VOICE_ORDER.forEach((voiceId) =>
    notesByVoice[voiceId].forEach((note) => {
      noteById.set(note.id, note);
      noteVoiceById.set(note.id, voiceId);
    }),
  );
  const chordById = new Map(
    snapshot.chordTrack.regions.map((chord) => [chord.id, chord] as const),
  );
  const sliceTransitions = buildSliceTransitions(slices, sliceSpanIds);
  const melodyTransitions = buildMelodyTransitions(analysisShell, notesByVoice);
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
  const cadenceCandidates = detectCadences({
    project: snapshot,
    harmonySpans,
    chordById,
    slices,
    phraseSegments: phraseAnalysis.segments,
  });

  return Object.freeze({
    revision,
    project: snapshot,
    metricTimeline,
    phraseBoundaries: phraseAnalysis.boundaries,
    phraseBoundaryCandidates: phraseAnalysis.candidates,
    phraseSegments: phraseAnalysis.segments,
    cadenceCandidates,
    cadenceAnnotations: snapshot.chordTrack.cadenceAnnotations,
    slices,
    harmonySpans,
    sliceSpanIds,
    chordSpanIds,
    melodyTransitions,
    sliceTransitions,
    connections,
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
