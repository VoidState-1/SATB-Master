import type { AnalysisNote } from "../../analysis";
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
