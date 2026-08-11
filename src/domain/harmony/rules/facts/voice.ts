import { VOICE_CONFIG } from "../../../project/voice";
import { toMidi } from "../../../pitch";
import {
  defineFact,
  fact,
  factNo,
  factYes,
  type PredicateNode,
} from "../declarative/facts";
import type { NoteCandidate } from "../declarative/candidates";
import type { ConstraintEnvironment } from "../declarative/constraint";
import { noteEvidence } from "../helpers/core";

export type VoiceRangeEnvironment = ConstraintEnvironment<NoteCandidate>;

export function configuredVoiceRange(environment: VoiceRangeEnvironment) {
  const { voiceId } = environment.candidate;
  const fallback = VOICE_CONFIG[voiceId];
  const configured = environment.config[voiceId];
  const configuredMin =
    configured && typeof configured === "object" && "minMidi" in configured
      ? configured.minMidi
      : undefined;
  const configuredMax =
    configured && typeof configured === "object" && "maxMidi" in configured
      ? configured.maxMidi
      : undefined;
  return {
    minimum:
      typeof configuredMin === "number" && Number.isFinite(configuredMin)
        ? configuredMin
        : fallback.min,
    maximum:
      typeof configuredMax === "number" && Number.isFinite(configuredMax)
        ? configuredMax
        : fallback.max,
  };
}

export function noteWithinConfiguredRange(): PredicateNode<VoiceRangeEnvironment> {
  return fact(
    defineFact({
      id: "voice.note-within-configured-range",
      requires: ["written-pitches"],
      evaluate(environment: VoiceRangeEnvironment) {
        const { voiceId, note } = environment.candidate;
        const { minimum, maximum } = configuredVoiceRange(environment);
        const midi = toMidi(note.pitch);
        const options = {
          evidence: [noteEvidence(note)],
          subjectRefs: { voiceIds: [voiceId], noteIds: [note.id] },
        };
        return midi >= minimum && midi <= maximum
          ? factYes("note-within-configured-range", options)
          : factNo("note-outside-configured-range", options);
      },
    }),
  );
}
