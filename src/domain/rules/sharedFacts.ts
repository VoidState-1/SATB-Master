import { chordIdentityToneSpellings } from "../chordModel";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  SliceTransition,
} from "../harmonyAnalysis";
import { VOICE_ORDER, type VoiceId } from "../project";
import {
  pitchClassEquals,
  toMidi,
  writtenInterval,
  type WrittenInterval,
} from "../pitch";

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
  bassMotion: BassMotion;
}

export interface ChordMemberFact {
  voiceId: VoiceId;
  note: AnalysisNote;
  chordToneIndex?: number;
  isChordTone: boolean;
}

function motion(previous: AnalysisNote, current: AnalysisNote): MotionDirection {
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

/**
 * 统一生成声部对事实。规则只判断自己的音程类型，不再分别重算声部方向、
 * 外/内声部身份和低音级进，从而保证不等五度等规则采用同一书写音高口径。
 */
export function voicePairTransitionFacts(
  transition: SliceTransition,
): readonly VoicePairTransitionFact[] {
  const result: VoicePairTransitionFact[] = [];
  for (let upperIndex = 0; upperIndex < VOICE_ORDER.length - 1; upperIndex += 1) {
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
          currentInterval: writtenInterval(currentLower.pitch, currentUpper.pitch),
          upperMotion,
          lowerMotion,
          sameDirection:
            upperMotion !== "stationary" && upperMotion === lowerMotion,
          outerVoicesOnly,
          includesInnerVoice: !outerVoicesOnly,
          bassMotion: bassMotionFact(transition),
        }),
      );
    }
  }
  return Object.freeze(result);
}

export function chordMemberFacts(
  slice: AnalysisSlice,
  chord: AnalysisChord,
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
          chordToneIndex:
            chordToneIndex >= 0 ? chordToneIndex : undefined,
          isChordTone: chordToneIndex >= 0,
        }),
      ];
    }),
  );
}
