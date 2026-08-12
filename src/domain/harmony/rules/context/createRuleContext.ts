import type { NonChordToneRole, VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type {
  AnalysisSlice,
  HarmonyAnalysis,
  MelodyTransition,
  SliceTransition,
} from "../../analysis";
import type { HarmonyConnectionAssessment } from "../connector";
import { createDiagnosticFactory, type DiagnosticFactory } from "../diagnostics/factory";
import { HarmonyQuery } from "../query/HarmonyQuery";
import { createHarmonyAnalysisService, type HarmonyAnalysisService } from "../services/harmony";
import { createMetricAnalysisService, type MetricAnalysisService } from "../services/metric";
import { createPitchAnalysisService, type PitchAnalysisService } from "../services/pitch";
import { createVoiceLeadingService, type VoiceLeadingService } from "../services/voiceLeading";
import type {
  ConnectionView,
  NoteNeighborhood,
  NoteView,
  SpanNeighborhood,
  SpanView,
} from "./views";
import { createHarmonyRuleIndexes } from "./indexes";

export interface NoteQueryOptions {
  readonly voiceId?: VoiceId;
  readonly role?: NonChordToneRole;
  readonly startingAt?: number;
  readonly startingAfter?: number;
}

export interface SliceQueryOptions {
  readonly containingTick?: number;
  readonly overlapping?: { readonly fromTick: number; readonly toTick: number };
}

export interface SpanQueryOptions {
  readonly containingTick?: number;
  readonly id?: string;
}

export interface ConnectionQueryOptions {
  readonly sourceSpanId?: string;
  readonly targetSpanId?: string;
}

export interface MelodyTransitionQueryOptions {
  readonly voiceId?: VoiceId;
}

export interface SliceTransitionQueryOptions {
  readonly fromSliceIndex?: number;
  readonly toSliceIndex?: number;
}

export interface HarmonyRuleContext {
  readonly analysis: HarmonyAnalysis;
  notes(options?: NoteQueryOptions): HarmonyQuery<NoteView>;
  slices(options?: SliceQueryOptions): HarmonyQuery<AnalysisSlice>;
  spans(options?: SpanQueryOptions): HarmonyQuery<SpanView>;
  connections(options?: ConnectionQueryOptions): HarmonyQuery<ConnectionView>;
  melodyTransitions(
    options?: MelodyTransitionQueryOptions,
  ): HarmonyQuery<MelodyTransition>;
  sliceTransitions(
    options?: SliceTransitionQueryOptions,
  ): HarmonyQuery<SliceTransition>;
  noteNeighborhood(note: NoteView): NoteNeighborhood | undefined;
  spanNeighborhood(span: SpanView): SpanNeighborhood;
  sliceAt(tick: number): AnalysisSlice | undefined;
  spanAt(tick: number): SpanView | undefined;
  keyAt(tick: number): HarmonyAnalysis["slices"][number]["key"] | undefined;
  readonly pitch: PitchAnalysisService;
  readonly metric: MetricAnalysisService;
  readonly harmony: HarmonyAnalysisService;
  readonly voiceLeading: VoiceLeadingService;
  readonly diagnostics: DiagnosticFactory;
}

export function createHarmonyRuleContext(
  analysis: HarmonyAnalysis,
): HarmonyRuleContext {
  const indexes = createHarmonyRuleIndexes(analysis);

  const context: HarmonyRuleContext = {
    analysis,
    notes(options = {}) {
      const source = options.voiceId
        ? indexes.noteViewsByVoice[options.voiceId]
        : options.role
          ? (indexes.noteViewsByRole.get(options.role) ?? [])
          : VOICE_ORDER.flatMap(
              (voiceId) => indexes.noteViewsByVoice[voiceId],
            );
      const timed = options.voiceId
        ? indexes.notesStarting(source, {
            at: options.startingAt,
            after: options.startingAfter,
          })
        : source;
      return HarmonyQuery.from(timed).where(({ note, voiceId }) => {
        if (options.voiceId !== undefined && voiceId !== options.voiceId)
          return false;
        if (options.role !== undefined && note.nonChordToneRole !== options.role)
          return false;
        if (
          !options.voiceId &&
          options.startingAt !== undefined &&
          note.startTick !== options.startingAt
        )
          return false;
        if (
          !options.voiceId &&
          options.startingAfter !== undefined &&
          note.startTick <= options.startingAfter
        )
          return false;
        return true;
      });
    },
    slices(options = {}) {
      if (options.containingTick !== undefined) {
        const slice = indexes.sliceAt(options.containingTick);
        if (!slice) return HarmonyQuery.empty();
        if (
          options.overlapping &&
          (slice.endTick <= options.overlapping.fromTick ||
            slice.tick >= options.overlapping.toTick)
        )
          return HarmonyQuery.empty();
        return HarmonyQuery.from([slice]);
      }
      if (options.overlapping)
        return HarmonyQuery.from(
          indexes.slicesOverlapping(
            options.overlapping.fromTick,
            options.overlapping.toTick,
          ),
        );
      return HarmonyQuery.from(analysis.slices);
    },
    spans(options = {}) {
      if (options.id !== undefined) {
        const span = indexes.spanViewById.get(options.id);
        if (!span) return HarmonyQuery.empty();
        if (
          options.containingTick !== undefined &&
          span !== indexes.spanAt(options.containingTick)
        )
          return HarmonyQuery.empty();
        return HarmonyQuery.from([span]);
      }
      if (options.containingTick !== undefined) {
        const span = indexes.spanAt(options.containingTick);
        return span ? HarmonyQuery.from([span]) : HarmonyQuery.empty();
      }
      return HarmonyQuery.from(indexes.spanViews);
    },
    connections(options = {}) {
      if (options.sourceSpanId && options.targetSpanId)
        return HarmonyQuery.from(
          indexes.connectionsByEndpoints.get(
            `${options.sourceSpanId}\u0000${options.targetSpanId}`,
          ) ?? [],
        );
      if (options.sourceSpanId)
        return HarmonyQuery.from(
          indexes.connectionsBySourceSpanId.get(options.sourceSpanId) ?? [],
        );
      if (options.targetSpanId)
        return HarmonyQuery.from(
          indexes.connectionsByTargetSpanId.get(options.targetSpanId) ?? [],
        );
      return HarmonyQuery.from(indexes.connectionViews);
    },
    melodyTransitions(options = {}) {
      return HarmonyQuery.from(
        options.voiceId
          ? (indexes.melodyTransitionsByVoice.get(options.voiceId) ?? [])
          : analysis.melodyTransitions,
      );
    },
    sliceTransitions(options = {}) {
      return HarmonyQuery.from(
        indexes.sliceTransitionsAt(
          options.fromSliceIndex,
          options.toSliceIndex,
        ),
      );
    },
    noteNeighborhood(note) {
      const current = indexes.noteViewById.get(note.note.id);
      if (current !== note) return undefined;
      const line = indexes.noteViewsByVoice[current.voiceId];
      const index = indexes.noteIndexById.get(current.note.id);
      const attackSlice = indexes.sliceAt(current.note.startTick);
      if (index === undefined || !attackSlice) return undefined;
      return Object.freeze({
        current,
        previous: line[index - 1],
        next: line[index + 1],
        attackSlice,
        span: indexes.spanAt(current.note.startTick),
      });
    },
    spanNeighborhood(current) {
      const canonical = indexes.spanViewById.get(current.span.id);
      if (canonical !== current)
        throw new Error("spanNeighborhood 需要当前 revision 的 SpanView");
      const index = indexes.spanIndexById.get(canonical.span.id);
      const previous =
        index === undefined ? undefined : indexes.spanViews[index - 1];
      const next =
        index === undefined ? undefined : indexes.spanViews[index + 1];
      return Object.freeze({
        current: canonical,
        previous,
        next,
        incoming: indexes.incomingBySpanId.get(canonical.span.id),
        outgoing: indexes.outgoingBySpanId.get(canonical.span.id),
      });
    },
    sliceAt: indexes.sliceAt,
    spanAt: indexes.spanAt,
    keyAt(tick) {
      return indexes.sliceAt(tick)?.key;
    },
    pitch: createPitchAnalysisService(),
    metric: createMetricAnalysisService(analysis.metricTimeline),
    harmony: createHarmonyAnalysisService(),
    voiceLeading: createVoiceLeadingService(),
    diagnostics: createDiagnosticFactory(analysis, indexes),
  };
  return Object.freeze(context);
}

export type { HarmonyConnectionAssessment };
