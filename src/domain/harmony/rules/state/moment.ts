import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { pitchClassEquals } from "../../../pitch";
import type { RuleStepContext } from "../../runtime";

export interface HarmonyChange {
  readonly previousSpanId?: string;
  readonly currentSpanId?: string;
  readonly previousChordId?: string;
  readonly currentChordId?: string;
}

export interface KeyChange {
  readonly previousKeyId: string;
  readonly currentKeyId: string;
}

export interface AnalysisMoment {
  readonly tick: number;
  readonly attackedVoiceIds: readonly VoiceId[];
  readonly releasedVoiceIds: readonly VoiceId[];
  readonly enteredRestVoiceIds: readonly VoiceId[];
  readonly harmonyChange?: HarmonyChange;
  readonly keyChange?: KeyChange;
}

export function analysisMoment(context: RuleStepContext): AnalysisMoment {
  const previous = context.previous;
  const current = context.slice;
  const previousSpanId = previous
    ? context.rules.spanAt(previous.tick)?.span.id
    : undefined;
  const currentSpanId = context.rules.spanAt(current.tick)?.span.id;
  const releasedVoiceIds = previous
    ? VOICE_ORDER.filter(
        (voiceId) =>
          previous.notes[voiceId] &&
          previous.notes[voiceId]?.id !== current.notes[voiceId]?.id,
      )
    : [];
  const enteredRestVoiceIds = previous
    ? VOICE_ORDER.filter(
        (voiceId) => previous.notes[voiceId] && !current.notes[voiceId],
      )
    : [];
  const harmonyChanged = Boolean(previous) && previousSpanId !== currentSpanId;
  const keyChanged = Boolean(
    previous &&
    (previous.key.mode !== current.key.mode ||
      !pitchClassEquals(previous.key.tonic, current.key.tonic)),
  );
  return Object.freeze({
    tick: current.tick,
    attackedVoiceIds: Object.freeze([...current.attackVoiceIds]),
    releasedVoiceIds: Object.freeze(releasedVoiceIds),
    enteredRestVoiceIds: Object.freeze(enteredRestVoiceIds),
    ...(harmonyChanged
      ? {
          harmonyChange: Object.freeze({
            ...(previousSpanId ? { previousSpanId } : {}),
            ...(currentSpanId ? { currentSpanId } : {}),
            ...(previous?.chord?.id
              ? { previousChordId: previous.chord.id }
              : {}),
            ...(current.chord?.id ? { currentChordId: current.chord.id } : {}),
          }),
        }
      : {}),
    ...(keyChanged && previous
      ? {
          keyChange: Object.freeze({
            previousKeyId: previous.key.id,
            currentKeyId: current.key.id,
          }),
        }
      : {}),
  });
}
