import { primaryHarmonyInterpretation } from "../../../chordModel";
import type {
  AnalysisNote,
  HarmonySpan,
} from "../../analysis";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { defineCandidateProvider } from "./constraint";

export interface NoteCandidate {
  readonly voiceId: VoiceId;
  readonly note: AnalysisNote;
}

export const eachNote = defineCandidateProvider<NoteCandidate>({
  id: "candidate.each-note",
  requires: ["written-pitches"],
  select(analysis) {
    return VOICE_ORDER.flatMap((voiceId) =>
      analysis.notesByVoice[voiceId].map((note) => ({ voiceId, note })),
    );
  },
  keyOf: (candidate) => `${candidate.voiceId}:${candidate.note.id}`,
});

export interface HarmonySpanCandidate {
  readonly span: HarmonySpan;
  readonly index: number;
  readonly previous?: HarmonySpan;
  readonly next?: HarmonySpan;
}

export const eachHarmonySpan = defineCandidateProvider<HarmonySpanCandidate>({
  id: "candidate.each-harmony-span",
  requires: ["chords"],
  select(analysis) {
    return analysis.harmonySpans.map((span, index) => ({
      span,
      index,
      previous: analysis.harmonySpans[index - 1],
      next: analysis.harmonySpans[index + 1],
    }));
  },
  keyOf: (candidate) => candidate.span.id,
});

export interface Cadential64TransitionCandidate {
  readonly sourceSpan: HarmonySpan;
  readonly targetSpan: HarmonySpan;
}

export const eachCadential64Transition =
  defineCandidateProvider<Cadential64TransitionCandidate>({
    id: "candidate.each-cadential64-transition",
    requires: ["chords", "semantics"],
    select(analysis) {
      return analysis.harmonySpans.flatMap((sourceSpan) => {
        const interpretation = sourceSpan.semantics
          ? primaryHarmonyInterpretation(sourceSpan.semantics)
          : undefined;
        if (
          interpretation?.designation?.kind !== "cadential64" &&
          sourceSpan.semantics?.cadenceRole !== "cadential64"
        )
          return [];
        const connection = analysis.connections.find(
          (candidate) => candidate.previousSpanId === sourceSpan.id,
        );
        const targetSpan = connection?.contiguous
          ? analysis.harmonySpans.find(
              (candidate) => candidate.id === connection.currentSpanId,
            )
          : undefined;
        return targetSpan ? [{ sourceSpan, targetSpan }] : [];
      });
    },
    keyOf: (candidate) =>
      `${candidate.sourceSpan.id}->${candidate.targetSpan.id}`,
  });
