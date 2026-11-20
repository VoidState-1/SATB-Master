import { canonicalJson } from "../canonicalJson";
import {
  chordIdentityEqualsWithoutBass,
  chordIdentityKeyWithoutBass,
  harmonySemanticsConfidence,
} from "../chordModel";
import { pitchClassEquals } from "../pitch";
import type { HarmonySemantics, VoiceId } from "../project/types";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisKey, AnalysisNote, AnalysisSlice, DeepReadonly, HarmonySpan, ProjectSnapshot } from "./analysis";

export function keyAtTick(events: readonly AnalysisKey[], tick: number) {
  let current = events[0];
  for (const event of events) {
    if (event.tick > tick) break;
    current = event;
  }
  if (!current) throw new Error("和声分析至少需要一个位于起点的调号事件");
  return current;
}

/** 内部辅助：判断两个调号事件是否同调（主音与调式一致） */
export function sameKey(left: AnalysisKey, right: AnalysisKey) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

/** 内部辅助：判断两个和弦的语义上下文是否相同 */
export function sameSemanticContext(
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
  return canonicalJson(left) === canonicalJson(right);
}

export { chordIdentityEqualsWithoutBass as sameChordIdentityWithoutBass } from "../chordModel";

/**
 * 按照所有音符、和弦、调号变更点分割时间轴为分析切片（AnalysisSlice）
 * 每个切片对应 [tick, endTick) 半开区间
 */
export function buildSlices(project: ProjectSnapshot) {
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

export function buildHarmonySpans(slices: readonly AnalysisSlice[]) {
  const groups: AnalysisSlice[][] = [];
  slices.forEach((slice) => {
    if (!slice.chord) return;
    const previous = groups.at(-1)?.at(-1);
    const canJoin = Boolean(
      previous &&
      previous.chord &&
      previous.endTick === slice.tick &&
      sameKey(previous.key, slice.key) &&
      chordIdentityEqualsWithoutBass(
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
      identityKey: chordIdentityKeyWithoutBass(first.identity),
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
