import type { SliceTransition } from "../../analysis";
import {
  voicePairTransitionFacts,
  type VoicePairTransitionFact,
} from "../sharedFacts";

export interface VoiceLeadingService {
  voicePairs(
    transition: SliceTransition,
  ): readonly VoicePairTransitionFact[];
}

export function createVoiceLeadingService(): VoiceLeadingService {
  return Object.freeze({
    voicePairs: voicePairTransitionFacts,
  });
}
