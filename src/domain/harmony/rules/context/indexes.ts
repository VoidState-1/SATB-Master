import type { NonChordToneRole, VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { clipHarmonySpan, sliceWithinSpan } from "../../cadence/spanRange";
import type {
  AnalysisSlice,
  HarmonyAnalysis,
  MelodyTransition,
  SliceTransition,
} from "../../analysis";
import type {
  ConnectionView,
  CadenceView,
  NoteView,
  SpanView,
} from "./views";

function firstIndex<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (predicate(items[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

function freezeMapValues<Key, Value>(source: Map<Key, Value[]>) {
  return new Map(
    [...source].map(([key, values]) => [key, Object.freeze(values)] as const),
  ) as ReadonlyMap<Key, readonly Value[]>;
}

export interface HarmonyRuleIndexes {
  readonly spanViews: readonly SpanView[];
  readonly spanViewById: ReadonlyMap<string, SpanView>;
  readonly spanIndexById: ReadonlyMap<string, number>;
  readonly cadenceViews: readonly CadenceView[];
  readonly cadenceViewById: ReadonlyMap<string, CadenceView>;
  readonly connectionViews: readonly ConnectionView[];
  readonly connectionViewByKey: ReadonlyMap<string, ConnectionView>;
  readonly connectionsBySourceSpanId: ReadonlyMap<
    string,
    readonly ConnectionView[]
  >;
  readonly connectionsByTargetSpanId: ReadonlyMap<
    string,
    readonly ConnectionView[]
  >;
  readonly connectionsByEndpoints: ReadonlyMap<
    string,
    readonly ConnectionView[]
  >;
  readonly incomingBySpanId: ReadonlyMap<string, ConnectionView>;
  readonly outgoingBySpanId: ReadonlyMap<string, ConnectionView>;
  readonly noteViewsByVoice: Readonly<Record<VoiceId, readonly NoteView[]>>;
  readonly noteViewsByRole: ReadonlyMap<
    NonChordToneRole,
    readonly NoteView[]
  >;
  readonly noteViewById: ReadonlyMap<string, NoteView>;
  readonly noteIndexById: ReadonlyMap<string, number>;
  readonly melodyTransitionsByVoice: ReadonlyMap<
    VoiceId,
    readonly MelodyTransition[]
  >;
  readonly sliceTransitionsByFromSliceIndex: ReadonlyMap<
    number,
    readonly SliceTransition[]
  >;
  readonly sliceTransitionsByToSliceIndex: ReadonlyMap<
    number,
    readonly SliceTransition[]
  >;
  sliceAt(tick: number): AnalysisSlice | undefined;
  slicesOverlapping(fromTick: number, toTick: number): readonly AnalysisSlice[];
  spanAt(tick: number): SpanView | undefined;
  cadenceAt(tick: number): CadenceView | undefined;
  notesStarting(
    source: readonly NoteView[],
    options: { readonly at?: number; readonly after?: number },
  ): readonly NoteView[];
  sliceTransitionsAt(
    fromSliceIndex?: number,
    toSliceIndex?: number,
  ): readonly SliceTransition[];
}

export function createHarmonyRuleIndexes(
  analysis: HarmonyAnalysis,
): HarmonyRuleIndexes {
  const spanViewById = new Map<string, SpanView>();
  const spanViews = analysis.harmonySpans.flatMap((span) => {
    const slices = span.sliceIndices.flatMap((index) => {
      const slice = analysis.slices[index];
      return slice ? [slice] : [];
    });
    const firstSlice = slices[0];
    const lastSlice = slices.at(-1);
    if (!firstSlice || !lastSlice) return [];
    const chords = span.regionIds.flatMap((id) => {
      const chord = analysis.chordById.get(id);
      return chord ? [chord] : [];
    });
    const view = Object.freeze({
      span,
      slices: Object.freeze(slices),
      firstSlice,
      lastSlice,
      chords: Object.freeze(chords),
    });
    spanViewById.set(span.id, view);
    return [view];
  });
  const frozenSpanViews = Object.freeze(spanViews);
  const spanIndexById = new Map(
    frozenSpanViews.map((view, index) => [view.span.id, index] as const),
  );

  const phraseById = new Map(
    analysis.phraseSegments.map((phrase) => [phrase.id, phrase] as const),
  );
  const spanViewsInRange = (fromTick: number, toTick: number) =>
    frozenSpanViews.flatMap(view => {
      const span = clipHarmonySpan(view.span, analysis.slices, fromTick, toTick);
      if (!span) return [];
      if (span === view.span) return [view];
      const slices = span.sliceIndices.map(index => sliceWithinSpan(analysis.slices[index], span));
      return [Object.freeze({ span, slices: Object.freeze(slices), firstSlice: slices[0], lastSlice: slices[slices.length - 1],
        chords: Object.freeze(view.chords.filter(chord => span.regionIds.includes(chord.id))) })];
    });
  const chordViewsInRange = (fromTick: number, toTick: number) =>
    analysis.project.chordTrack.regions.filter(
      (chord) =>
        chord.startTick < toTick &&
        chord.startTick + chord.durationTicks > fromTick,
    );
  const candidateViews = analysis.cadenceCandidates.map((candidate) => {
    const spans = spanViewsInRange(candidate.fromTick, candidate.toTick);
    return Object.freeze({
      id: candidate.id,
      fromTick: candidate.fromTick,
      toTick: candidate.toTick,
      phraseId: candidate.phraseId,
      kind: candidate.kind,
      form: candidate.form,
      completion: candidate.completion,
      confidence: candidate.confidence,
      source: "candidate" as const,
      candidate,
      phrase: phraseById.get(candidate.phraseId),
      spans: Object.freeze(spans),
      chords: Object.freeze(chordViewsInRange(candidate.fromTick, candidate.toTick)),
      evidence: candidate.evidence,
    });
  });
  const annotationViews = analysis.cadenceAnnotations.map((annotation) => {
    const spans = spanViewsInRange(annotation.fromTick, annotation.toTick);
    return Object.freeze({
      id: annotation.id,
      fromTick: annotation.fromTick,
      toTick: annotation.toTick,
      phraseId: annotation.phraseId,
      kind: annotation.kind,
      form: annotation.form,
      completion: annotation.completion,
      confidence: annotation.confidence,
      source: annotation.source,
      annotation,
      phrase: phraseById.get(annotation.phraseId),
      spans: Object.freeze(spans),
      chords: Object.freeze(chordViewsInRange(annotation.fromTick, annotation.toTick)),
      evidence: Object.freeze([]),
    });
  });
  const annotatedRangeKeys = new Set(
    annotationViews.map((view) => `${view.phraseId}:${view.fromTick}:${view.toTick}`),
  );
  const cadenceViews = Object.freeze([
    ...annotationViews,
    ...candidateViews.filter(
      (view) =>
        !annotatedRangeKeys.has(`${view.phraseId}:${view.fromTick}:${view.toTick}`),
    ),
  ]);
  const cadenceViewById = new Map(
    cadenceViews.map((view) => [view.id, view] as const),
  );

  const connectionsBySource = new Map<string, ConnectionView[]>();
  const connectionsByTarget = new Map<string, ConnectionView[]>();
  const connectionsByEndpoints = new Map<string, ConnectionView[]>();
  const incomingBySpanId = new Map<string, ConnectionView>();
  const outgoingBySpanId = new Map<string, ConnectionView>();
  const connectionViews = analysis.connections.flatMap((connection) => {
    const source = spanViewById.get(connection.previousSpanId);
    const target = spanViewById.get(connection.currentSpanId);
    if (!source || !target) return [];
    const view = Object.freeze({
      connection,
      source,
      target,
      sourceBoundary: source.lastSlice,
      targetBoundary: target.firstSlice,
    });
    const endpointKey = `${source.span.id}\u0000${target.span.id}`;
    const sourceGroup = connectionsBySource.get(source.span.id) ?? [];
    const targetGroup = connectionsByTarget.get(target.span.id) ?? [];
    const endpointGroup = connectionsByEndpoints.get(endpointKey) ?? [];
    sourceGroup.push(view);
    targetGroup.push(view);
    endpointGroup.push(view);
    connectionsBySource.set(source.span.id, sourceGroup);
    connectionsByTarget.set(target.span.id, targetGroup);
    connectionsByEndpoints.set(endpointKey, endpointGroup);
    outgoingBySpanId.set(source.span.id, view);
    incomingBySpanId.set(target.span.id, view);
    return [view];
  });
  const connectionViewByKey = new Map(
    connectionViews.map((view) => [view.connection.connectionKey, view]),
  );

  const noteViewsByRole = new Map<NonChordToneRole, NoteView[]>();
  const noteViewById = new Map<string, NoteView>();
  const noteIndexById = new Map<string, number>();
  const noteViewsByVoice = Object.fromEntries(
    VOICE_ORDER.map((voiceId) => {
      const views = analysis.notesByVoice[voiceId].map((note, index) => {
        const view = Object.freeze({ voiceId, note });
        noteViewById.set(note.id, view);
        noteIndexById.set(note.id, index);
        if (note.nonChordToneRole) {
          const roleGroup = noteViewsByRole.get(note.nonChordToneRole) ?? [];
          roleGroup.push(view);
          noteViewsByRole.set(note.nonChordToneRole, roleGroup);
        }
        return view;
      });
      return [voiceId, Object.freeze(views)] as const;
    }),
  ) as Readonly<Record<VoiceId, readonly NoteView[]>>;

  const melodyTransitionsByVoice = new Map<VoiceId, MelodyTransition[]>();
  for (const transition of analysis.melodyTransitions) {
    const group = melodyTransitionsByVoice.get(transition.voiceId) ?? [];
    group.push(transition);
    melodyTransitionsByVoice.set(transition.voiceId, group);
  }

  const sliceTransitionsByFromSliceIndex = new Map<
    number,
    SliceTransition[]
  >();
  const sliceTransitionsByToSliceIndex = new Map<number, SliceTransition[]>();
  for (const transition of analysis.sliceTransitions) {
    const fromGroup =
      sliceTransitionsByFromSliceIndex.get(transition.previousIndex) ?? [];
    const toGroup =
      sliceTransitionsByToSliceIndex.get(transition.currentIndex) ?? [];
    fromGroup.push(transition);
    toGroup.push(transition);
    sliceTransitionsByFromSliceIndex.set(transition.previousIndex, fromGroup);
    sliceTransitionsByToSliceIndex.set(transition.currentIndex, toGroup);
  }

  const sliceAt = (tick: number) => {
    if (!Number.isFinite(tick) || tick < 0) return undefined;
    const index = firstIndex(analysis.slices, (slice) => slice.endTick > tick);
    const slice = analysis.slices[index];
    return slice && slice.tick <= tick ? slice : undefined;
  };
  const spanAt = (tick: number) => {
    if (!Number.isFinite(tick) || tick < 0) return undefined;
    const index = firstIndex(frozenSpanViews, (view) => view.span.toTick > tick);
    const view = frozenSpanViews[index];
    return view && view.span.fromTick <= tick ? view : undefined;
  };

  return Object.freeze({
    spanViews: frozenSpanViews,
    spanViewById,
    spanIndexById,
    cadenceViews,
    cadenceViewById,
    connectionViews: Object.freeze(connectionViews),
    connectionViewByKey,
    connectionsBySourceSpanId: freezeMapValues(connectionsBySource),
    connectionsByTargetSpanId: freezeMapValues(connectionsByTarget),
    connectionsByEndpoints: freezeMapValues(connectionsByEndpoints),
    incomingBySpanId,
    outgoingBySpanId,
    noteViewsByVoice,
    noteViewsByRole: freezeMapValues(noteViewsByRole),
    noteViewById,
    noteIndexById,
    melodyTransitionsByVoice: freezeMapValues(melodyTransitionsByVoice),
    sliceTransitionsByFromSliceIndex: freezeMapValues(
      sliceTransitionsByFromSliceIndex,
    ),
    sliceTransitionsByToSliceIndex: freezeMapValues(
      sliceTransitionsByToSliceIndex,
    ),
    sliceAt,
    slicesOverlapping(fromTick: number, toTick: number) {
      if (
        !Number.isFinite(fromTick) ||
        !Number.isFinite(toTick) ||
        toTick <= fromTick
      )
        return [];
      const start = firstIndex(
        analysis.slices,
        (slice) => slice.endTick > fromTick,
      );
      const end = firstIndex(analysis.slices, (slice) => slice.tick >= toTick);
      return analysis.slices.slice(start, end);
    },
    spanAt,
    cadenceAt(tick: number) {
      return cadenceViews.find(
        (view) => view.fromTick <= tick && tick < view.toTick,
      );
    },
    notesStarting(
      source: readonly NoteView[],
      options: { readonly at?: number; readonly after?: number },
    ) {
      if (options.at !== undefined) {
        if (options.after !== undefined && options.at <= options.after)
          return [];
        const start = firstIndex(
          source,
          ({ note }) => note.startTick >= options.at!,
        );
        const end = firstIndex(
          source,
          ({ note }) => note.startTick > options.at!,
        );
        return source.slice(start, end);
      }
      if (options.after !== undefined) {
        const start = firstIndex(
          source,
          ({ note }) => note.startTick > options.after!,
        );
        return source.slice(start);
      }
      return source;
    },
    sliceTransitionsAt(
      fromSliceIndex?: number,
      toSliceIndex?: number,
    ) {
      if (fromSliceIndex !== undefined && toSliceIndex !== undefined)
        return (
          sliceTransitionsByFromSliceIndex
            .get(fromSliceIndex)
            ?.filter(
              (transition) => transition.currentIndex === toSliceIndex,
            ) ?? []
        );
      if (fromSliceIndex !== undefined)
        return sliceTransitionsByFromSliceIndex.get(fromSliceIndex) ?? [];
      if (toSliceIndex !== undefined)
        return sliceTransitionsByToSliceIndex.get(toSliceIndex) ?? [];
      return analysis.sliceTransitions;
    },
  });
}
