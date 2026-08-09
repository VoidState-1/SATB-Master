import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../chordModel";
import {
  VOICE_ORDER,
  type ChordRegion,
  type HarmonySemantics,
  type KeyEvent,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../project";
import {
  pitchClassEquals,
  writtenInterval,
  type WrittenInterval,
} from "../pitch";
import type { RuleDependencyScope } from "./ruleTypes";
import {
  buildHarmonyConnections,
  type HarmonyConnectionAssessment,
} from "./rules/connector";
import {
  buildHarmonyContextFacts,
  type HarmonyContextFacts,
} from "./rules/sharedFacts";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ProjectSnapshot = DeepReadonly<ProjectDocument>;
export type AnalysisNote = DeepReadonly<NoteEvent>;
export type AnalysisChord = DeepReadonly<ChordRegion>;
export type AnalysisKey = DeepReadonly<KeyEvent>;

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

export interface SliceTransition {
  readonly id: string;
  readonly previousIndex: number;
  readonly currentIndex: number;
  readonly previous: AnalysisSlice;
  readonly current: AnalysisSlice;
  readonly contiguous: boolean;
  readonly sameKey: boolean;
  readonly sameHarmony: boolean;
  readonly changedVoiceIds: readonly VoiceId[];
}

export interface HarmonySpan {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly regionIds: readonly string[];
  readonly sliceIndices: readonly number[];
  readonly identityKey: string;
  readonly semantics?: DeepReadonly<HarmonySemantics>;
  readonly status: "complete" | "ambiguous";
  readonly entryTransitionIndex?: number;
  readonly exitTransitionIndex?: number;
}

export interface AnalysisInvalidationRange {
  readonly fromTick: number;
  readonly toTick: number;
  readonly scopes: readonly RuleDependencyScope[];
}

export interface HarmonyAnalysis {
  readonly revision: number;
  readonly project: ProjectSnapshot;
  readonly slices: readonly AnalysisSlice[];
  readonly harmonySpans: readonly HarmonySpan[];
  readonly sliceSpanIds: ReadonlyMap<number, string>;
  readonly chordSpanIds: ReadonlyMap<string, readonly string[]>;
  readonly melodyTransitions: readonly MelodyTransition[];
  readonly sliceTransitions: readonly SliceTransition[];
  readonly connections: readonly HarmonyConnectionAssessment[];
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

function keyAtTick(events: readonly AnalysisKey[], tick: number) {
  let current = events[0];
  for (const event of events) {
    if (event.tick > tick) break;
    current = event;
  }
  if (!current) throw new Error("和声分析至少需要一个位于起点的调号事件");
  return current;
}

export function analysisKeyAtTick(analysis: HarmonyAnalysis, tick: number) {
  return keyAtTick(analysis.project.keyEvents, tick);
}

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

function sameKey(left: AnalysisKey, right: AnalysisKey) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

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

function sameChordIdentityWithoutBass(
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

function chordContinuity(previous: AnalysisChord, current: AnalysisChord) {
  return (
    previous.id === current.id ||
    previous.startTick + previous.durationTicks === current.startTick
  );
}

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

function buildSlices(project: ProjectSnapshot) {
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

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const tick = ordered[index];
    while (
      chordIndex < chords.length &&
      chords[chordIndex].startTick + chords[chordIndex].durationTicks <= tick
    )
      chordIndex += 1;
    while (
      keyIndex + 1 < project.keyEvents.length &&
      project.keyEvents[keyIndex + 1].tick <= tick
    )
      keyIndex += 1;

    const notes: Partial<Record<VoiceId, AnalysisNote>> = {};
    const attackVoiceIds: VoiceId[] = [];
    VOICE_ORDER.forEach((voiceId) => {
      const source = notesByVoice[voiceId];
      let noteIndex = noteIndexes[voiceId];
      while (
        noteIndex < source.length &&
        source[noteIndex].startTick + source[noteIndex].durationTicks <= tick
      )
        noteIndex += 1;
      noteIndexes[voiceId] = noteIndex;
      const note = source[noteIndex];
      if (
        note &&
        note.startTick <= tick &&
        note.startTick + note.durationTicks > tick
      ) {
        notes[voiceId] = note;
        if (note.startTick === tick) attackVoiceIds.push(voiceId);
      }
    });

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
      ...new Set(group.flatMap((slice) => (slice.chord ? [slice.chord.id] : []))),
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
      ? primaryHarmonyInterpretation(semantics).confidence
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

export function buildHarmonyAnalysis(
  project: ProjectDocument,
  revision = 0,
  previousSnapshot?: ProjectSnapshot,
): HarmonyAnalysis {
  // 调度器只向规则暴露冻结后的克隆，避免内置或未来外置规则意外改写编辑器状态。
  const snapshot = deepFreeze(structuredClone(project));
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
  const contextFacts = buildHarmonyContextFacts({
    slices,
    harmonySpans,
    melodyTransitions,
    sliceTransitions,
    connections,
  });

  return Object.freeze({
    revision,
    project: snapshot,
    slices,
    harmonySpans,
    sliceSpanIds,
    chordSpanIds,
    melodyTransitions,
    sliceTransitions,
    connections,
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

export function previousSlice(
  analysis: HarmonyAnalysis,
  index: number,
  options: { contiguous?: boolean } = {},
) {
  const current = analysis.slices[index];
  if (!current) return undefined;
  const previous = analysis.slices[index - 1];
  if (!previous) return undefined;
  if (options.contiguous && previous.endTick !== current.tick)
    return undefined;
  return previous;
}

export function nextSlice(
  analysis: HarmonyAnalysis,
  index: number,
  options: { contiguous?: boolean } = {},
) {
  const current = analysis.slices[index];
  if (!current) return undefined;
  const next = analysis.slices[index + 1];
  if (!next) return undefined;
  if (options.contiguous && current.endTick !== next.tick)
    return undefined;
  return next;
}

export function walkSlices(
  analysis: HarmonyAnalysis,
  index: number,
  direction: "forward" | "backward",
  predicate?: (slice: AnalysisSlice) => boolean,
) {
  const result: AnalysisSlice[] = [];
  const step = direction === "forward" ? 1 : -1;
  for (
    let cursor = index + step;
    cursor >= 0 && cursor < analysis.slices.length;
    cursor += step
  ) {
    const slice = analysis.slices[cursor];
    result.push(slice);
    if (predicate?.(slice)) break;
  }
  return Object.freeze(result);
}

export function harmonySpanAtTick(analysis: HarmonyAnalysis, tick: number) {
  return analysis.harmonySpans.find(
    (span) => span.fromTick <= tick && span.toTick > tick,
  );
}

export function harmonySpanAtSlice(
  analysis: HarmonyAnalysis,
  sliceIndex: number,
) {
  const spanId = analysis.sliceSpanIds.get(sliceIndex);
  return spanId
    ? analysis.harmonySpans.find((span) => span.id === spanId)
    : undefined;
}

export function walkSpans(
  analysis: HarmonyAnalysis,
  spanIndex: number,
  direction: "forward" | "backward",
  predicate?: (span: HarmonySpan) => boolean,
) {
  const result: HarmonySpan[] = [];
  const step = direction === "forward" ? 1 : -1;
  for (
    let cursor = spanIndex + step;
    cursor >= 0 && cursor < analysis.harmonySpans.length;
    cursor += step
  ) {
    const span = analysis.harmonySpans[cursor];
    result.push(span);
    if (predicate?.(span)) break;
  }
  return Object.freeze(result);
}

export function previousAttack(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  tick: number,
) {
  return analysis.notesByVoice[voiceId]
    .filter((note) => note.startTick < tick)
    .at(-1);
}

export function nextAttack(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  tick: number,
) {
  return analysis.notesByVoice[voiceId].find(
    (note) => note.startTick >= tick,
  );
}
