import { chordIdentityToneSpellings } from "./chordModel";
import {
  VOICE_ORDER,
  type ChordRegion,
  type FunctionalAnalysis,
  type KeyEvent,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./model";
import {
  pitchClassEquals,
  writtenInterval,
  type WrittenInterval,
} from "./pitch";
import type { RuleDependencyScope } from "./harmonyRules";

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

export type FunctionalClass =
  | "tonic"
  | "predominant"
  | "dominant"
  | "secondary-dominant"
  | "chromatic-predominant"
  | "mixture"
  | "ambiguous";

export interface AnalysisSlice {
  readonly tick: number;
  readonly endTick: number;
  readonly notes: Readonly<Partial<Record<VoiceId, AnalysisNote>>>;
  readonly attackVoiceIds: readonly VoiceId[];
  readonly key: AnalysisKey;
  readonly chord?: AnalysisChord;
  readonly completeSatb: boolean;
}

export interface MelodyTransition {
  readonly voiceId: VoiceId;
  readonly previous: AnalysisNote;
  readonly current: AnalysisNote;
  readonly contiguous: boolean;
  readonly sameKey: boolean;
  readonly sameHarmony: boolean;
  readonly writtenInterval: WrittenInterval;
}

export interface SliceTransition {
  readonly previous: AnalysisSlice;
  readonly current: AnalysisSlice;
  readonly sameHarmony: boolean;
}

export interface ChordProgression {
  readonly previous: AnalysisChord;
  readonly current: AnalysisChord;
  readonly contiguous: boolean;
  readonly sameKey: boolean;
  readonly sameHarmony: boolean;
  readonly previousClass: FunctionalClass;
  readonly currentClass: FunctionalClass;
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
  readonly melodyTransitions: readonly MelodyTransition[];
  readonly sliceTransitions: readonly SliceTransition[];
  readonly chordProgressions: readonly ChordProgression[];
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
      region.startTick <= tick && region.startTick + region.durationTicks > tick,
  );
}

function sameKey(left: AnalysisKey, right: AnalysisKey) {
  return (
    left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic)
  );
}

function sameOptionalKey(
  left: FunctionalAnalysis["localKey"],
  right: FunctionalAnalysis["localKey"],
) {
  if (!left || !right) return left === right;
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function sameFunctionalContext(
  left: DeepReadonly<FunctionalAnalysis> | undefined,
  right: DeepReadonly<FunctionalAnalysis> | undefined,
) {
  if (!left || !right) return false;
  return (
    left.degree === right.degree &&
    left.degreeAlteration === right.degreeAlteration &&
    left.quality === right.quality &&
    left.applied?.targetDegree === right.applied?.targetDegree &&
    left.mixture === right.mixture &&
    left.cadenceRole === right.cadenceRole &&
    sameOptionalKey(left.localKey, right.localKey)
  );
}

function sameChordIdentityWithoutBass(
  left: AnalysisChord["identity"],
  right: AnalysisChord["identity"],
) {
  if (
    left.quality !== right.quality ||
    !pitchClassEquals(left.root, right.root)
  )
    return false;
  const serializeTone = (tone: { step: string; alter: number }) =>
    `${tone.step}:${tone.alter}`;
  const leftTones = chordIdentityToneSpellings(left).map(serializeTone).sort();
  const rightTones = chordIdentityToneSpellings(right).map(serializeTone).sort();
  return (
    leftTones.length === rightTones.length &&
    leftTones.every((tone, index) => tone === rightTones[index])
  );
}

export function functionalClassOf(
  analysis: DeepReadonly<FunctionalAnalysis> | undefined,
): FunctionalClass {
  if (!analysis) return "ambiguous";
  if (analysis.mixture) return "mixture";
  if (analysis.applied) {
    return [5, 7].includes(analysis.degree)
      ? "secondary-dominant"
      : "ambiguous";
  }
  if (analysis.degreeAlteration !== 0 && [2, 4].includes(analysis.degree))
    return "chromatic-predominant";
  if ([1, 3, 6].includes(analysis.degree)) return "tonic";
  if ([2, 4].includes(analysis.degree)) return "predominant";
  if ([5, 7].includes(analysis.degree)) return "dominant";
  return "ambiguous";
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
    sameChordIdentityWithoutBass(previousChord.identity, currentChord.identity) &&
    sameFunctionalContext(previousChord.function, currentChord.function)
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
    });
  }

  return { slices: Object.freeze(slices), notesByVoice };
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
      const previousKey = keyAtTick(analysis.project.keyEvents, previous.startTick);
      const currentKey = keyAtTick(analysis.project.keyEvents, current.startTick);
      transitions.push({
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

function buildChordProgressions(analysis: Pick<HarmonyAnalysis, "project">) {
  const regions = [...analysis.project.chordTrack.regions].sort(
    (left, right) => left.startTick - right.startTick,
  );
  const progressions: ChordProgression[] = [];
  for (let index = 1; index < regions.length; index += 1) {
    const previous = regions[index - 1];
    const current = regions[index];
    const previousKey = keyAtTick(
      analysis.project.keyEvents,
      previous.startTick,
    );
    const currentKey = keyAtTick(analysis.project.keyEvents, current.startTick);
    progressions.push({
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
      previousClass: functionalClassOf(previous.function),
      currentClass: functionalClassOf(current.function),
    });
  }
  return Object.freeze(progressions);
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
      track.notes.map((note) => [note.id, { note, voiceId: track.id }] as const),
    ),
  );
  const currentNotes = new Map(
    current.satbTracks.flatMap((track) =>
      track.notes.map((note) => [note.id, { note, voiceId: track.id }] as const),
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

  if (entitySignature(previous.keyEvents) !== entitySignature(current.keyEvents)) {
    ranges.push(
      changeRange(0, current.lengthTicks, ["slice", "chord", "phrase", "project"]),
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
  const analysisShell = { project: snapshot } as Pick<HarmonyAnalysis, "project">;
  const { slices, notesByVoice } = buildSlices(snapshot);
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
  const sliceTransitions = Object.freeze(
    slices.slice(1).map((current, index) => ({
      previous: slices[index],
      current,
      sameHarmony: sameHarmonyAtTicks(
        analysisShell,
        slices[index].tick,
        current.tick,
      ),
    })),
  );

  return Object.freeze({
    revision,
    project: snapshot,
    slices,
    melodyTransitions: buildMelodyTransitions(analysisShell, notesByVoice),
    sliceTransitions,
    chordProgressions: buildChordProgressions(analysisShell),
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
