import { identityContainsWrittenPitchClass, chordIdentityToneSpellings } from "../../chordModel";
import type {
  AnalysisChord,
  HarmonyAnalysis,
  AnalysisNote,
  AnalysisSlice,
  SliceTransition,
} from "../analysis";
import type { VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import {
  pitchClassEquals,
  toMidi,
  writtenInterval,
  type WrittenInterval,
} from "../../pitch";

export type MotionDirection = "up" | "down" | "stationary";
export type BassMotion = "step-up" | "step-down" | "other" | "stationary";

export interface VoicePairTransitionFact {
  voiceIds: readonly [VoiceId, VoiceId];
  previousNotes: readonly [AnalysisNote, AnalysisNote];
  currentNotes: readonly [AnalysisNote, AnalysisNote];
  previousInterval: WrittenInterval;
  currentInterval: WrittenInterval;
  upperMotion: MotionDirection;
  lowerMotion: MotionDirection;
  sameDirection: boolean;
  outerVoicesOnly: boolean;
  includesInnerVoice: boolean;
  voiceExchange: boolean;
  bassMotion: BassMotion;
}

export interface StructuralVoicePairComparison {
  /** The actual harmonic boundary ID with the verified, possibly non-adjacent frames. */
  readonly transition: SliceTransition;
  readonly fact: VoicePairTransitionFact;
  readonly boundaryTick: number;
}

export interface ChordMemberFact {
  voiceId: VoiceId;
  note: AnalysisNote;
  chordToneIndex?: number;
  isWrittenChordTone: boolean;
}

export interface HarmonyContextFacts {
  readonly sameHarmonyTransitionIds: readonly string[];
  readonly arpeggiationTransitionIds: readonly string[];
  readonly voiceExchangeTransitionIds: readonly string[];
  readonly innerVoiceTransitionIds: readonly string[];
  readonly bassStepUpTransitionIds: readonly string[];
  readonly nonchordToneNoteIds: readonly string[];
  readonly pedalSpanIds: readonly string[];
  readonly cadenceSpanIds: readonly string[];
  readonly modulationConnectionIds: readonly string[];
}

function motion(
  previous: AnalysisNote,
  current: AnalysisNote,
): MotionDirection {
  const difference = toMidi(current.pitch) - toMidi(previous.pitch);
  return difference > 0 ? "up" : difference < 0 ? "down" : "stationary";
}

export function bassMotionFact(transition: SliceTransition): BassMotion {
  const previous = transition.previous.notes.bass;
  const current = transition.current.notes.bass;
  if (!previous || !current) return "other";
  const interval = writtenInterval(previous.pitch, current.pitch);
  if (interval.semitones === 0) return "stationary";
  if (interval.diatonicSteps === 1 && interval.semitones > 0) return "step-up";
  if (interval.diatonicSteps === -1 && interval.semitones < 0)
    return "step-down";
  return "other";
}

function voicesExchangeAt(
  transition: SliceTransition,
  left: VoiceId,
  right: VoiceId,
) {
  const previousLeft = transition.previous.notes[left];
  const previousRight = transition.previous.notes[right];
  const currentLeft = transition.current.notes[left];
  const currentRight = transition.current.notes[right];
  return Boolean(
    previousLeft && previousRight && currentLeft && currentRight &&
    previousLeft.id !== currentLeft.id &&
    previousRight.id !== currentRight.id &&
    pitchClassEquals(previousLeft.pitch, currentRight.pitch) &&
    pitchClassEquals(previousRight.pitch, currentLeft.pitch)
  );
}

/**
 * 统一生成声部对事实。规则只判断自己的音程类型，不再分别重算声部方向、
 * 外/内声部身份和低音级进，从而保证不等五度等规则采用同一书写音高口径。
 */
export function voicePairTransitionFacts(
  transition: SliceTransition,
): readonly VoicePairTransitionFact[] {
  const result: VoicePairTransitionFact[] = [];
  for (
    let upperIndex = 0;
    upperIndex < VOICE_ORDER.length - 1;
    upperIndex += 1
  ) {
    for (
      let lowerIndex = upperIndex + 1;
      lowerIndex < VOICE_ORDER.length;
      lowerIndex += 1
    ) {
      const upperId = VOICE_ORDER[upperIndex];
      const lowerId = VOICE_ORDER[lowerIndex];
      const previousUpper = transition.previous.notes[upperId];
      const previousLower = transition.previous.notes[lowerId];
      const currentUpper = transition.current.notes[upperId];
      const currentLower = transition.current.notes[lowerId];
      if (!previousUpper || !previousLower || !currentUpper || !currentLower)
        continue;
      const upperMotion = motion(previousUpper, currentUpper);
      const lowerMotion = motion(previousLower, currentLower);
      const outerVoicesOnly = upperId === "soprano" && lowerId === "bass";
      result.push(
        Object.freeze({
          voiceIds: Object.freeze([upperId, lowerId] as const),
          previousNotes: Object.freeze([previousUpper, previousLower] as const),
          currentNotes: Object.freeze([currentUpper, currentLower] as const),
          previousInterval: writtenInterval(
            previousLower.pitch,
            previousUpper.pitch,
          ),
          currentInterval: writtenInterval(
            currentLower.pitch,
            currentUpper.pitch,
          ),
          upperMotion,
          lowerMotion,
          sameDirection:
            upperMotion !== "stationary" && upperMotion === lowerMotion,
          outerVoicesOnly,
          includesInnerVoice: !outerVoicesOnly,
          voiceExchange: voicesExchangeAt(transition, upperId, lowerId),
          bassMotion: bassMotionFact(transition),
        }),
      );
    }
  }
  return Object.freeze(result);
}

export function chordMemberFacts(
  slice: AnalysisSlice,
  chord: Pick<AnalysisChord, "identity">,
): readonly ChordMemberFact[] {
  const tones = chordIdentityToneSpellings(chord.identity);
  return Object.freeze(
    VOICE_ORDER.flatMap((voiceId) => {
      const note = slice.notes[voiceId];
      if (!note) return [];
      const chordToneIndex = tones.findIndex((tone) =>
        pitchClassEquals(note.pitch, tone),
      );
      return [
        Object.freeze({
          voiceId,
          note,
          chordToneIndex: chordToneIndex >= 0 ? chordToneIndex : undefined,
          isWrittenChordTone: identityContainsWrittenPitchClass(
            chord.identity,
            note.pitch,
          ),
        }),
      ];
    }),
  );
}

export function buildHarmonyContextFacts(
  analysis: Pick<
    HarmonyAnalysis,
    | "slices"
    | "harmonySpans"
    | "melodyTransitions"
    | "sliceTransitions"
    | "connections"
  >,
): HarmonyContextFacts {
  const sliceByTick = (tick: number) =>
    analysis.slices.find((slice) => slice.tick <= tick && tick < slice.endTick);
  const sameHarmonyTransitionIds = [
    // Sustained notes can span a new slice without making a musical motion.
    ...analysis.sliceTransitions
      .filter((transition) =>
        transition.sameHarmony && transition.contiguous && transition.changedVoiceIds.length > 0,
      )
      .map((transition) => transition.id),
    ...analysis.melodyTransitions
      .filter((transition) => transition.sameHarmony && transition.contiguous)
      .map((transition) => transition.id),
  ];
  const arpeggiationTransitionIds = analysis.melodyTransitions
    .filter((transition) => {
      if (!transition.sameHarmony || !transition.contiguous) return false;
      const previousSlice = sliceByTick(transition.previous.startTick);
      const currentSlice = sliceByTick(transition.current.startTick);
      if (!previousSlice?.chord || !currentSlice?.chord) return false;
      const previousMember = chordMemberFacts(
        previousSlice,
        previousSlice.chord,
      ).find((fact) => fact.voiceId === transition.voiceId);
      const currentMember = chordMemberFacts(
        currentSlice,
        currentSlice.chord,
      ).find((fact) => fact.voiceId === transition.voiceId);
      return Boolean(
        previousMember?.isWrittenChordTone && currentMember?.isWrittenChordTone,
      );
    })
    .map((transition) => transition.id);
  const voiceExchangeTransitionIds = analysis.sliceTransitions
    .filter((transition) => {
      const changed = transition.changedVoiceIds;
      return changed.some((left, leftIndex) =>
        changed.slice(leftIndex + 1).some((right) =>
          voicesExchangeAt(transition, left, right),
        ),
      );
    })
    .map((transition) => transition.id);
  const innerVoiceTransitionIds = analysis.sliceTransitions
    .filter(
      (transition) =>
        transition.changedVoiceIds.length > 0 &&
        transition.changedVoiceIds.every(
          (voiceId) => voiceId !== "soprano" && voiceId !== "bass",
        ),
    )
    .map((transition) => transition.id);
  const bassStepUpTransitionIds = analysis.sliceTransitions
    .filter((transition) => bassMotionFact(transition) === "step-up")
    .map((transition) => transition.id);
  const nonchordToneNoteIds = [
    ...new Set(
      analysis.slices.flatMap((slice) => {
        if (!slice.chord) return [];
        return chordMemberFacts(slice, slice.chord)
          .filter(
            (fact) =>
              !fact.isWrittenChordTone && Boolean(fact.note.nonChordToneRole),
          )
          .map((fact) => fact.note.id);
      }),
    ),
  ];

  return Object.freeze({
    sameHarmonyTransitionIds: Object.freeze(sameHarmonyTransitionIds),
    arpeggiationTransitionIds: Object.freeze(arpeggiationTransitionIds),
    voiceExchangeTransitionIds: Object.freeze(voiceExchangeTransitionIds),
    innerVoiceTransitionIds: Object.freeze(innerVoiceTransitionIds),
    bassStepUpTransitionIds: Object.freeze(bassStepUpTransitionIds),
    nonchordToneNoteIds: Object.freeze(nonchordToneNoteIds),
    pedalSpanIds: Object.freeze(
      analysis.harmonySpans
        .filter((span) => Boolean(span.semantics?.pedalContext))
        .map((span) => span.id),
    ),
    cadenceSpanIds: Object.freeze(
      analysis.harmonySpans
        .filter((span) => Boolean(span.semantics?.cadenceRole))
        .map((span) => span.id),
    ),
    modulationConnectionIds: Object.freeze(
      analysis.connections
        .filter(
          (connection) =>
            !connection.sameKey ||
            connection.relation === "pivot-reinterpretation",
        )
        .map((connection) => connection.connectionKey),
    ),
  });
}
