import { chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals } from "../../pitch";
import { upperPassingMotion } from "../upperPassingMotion";
import { fitProlongedHarmony } from "./candidates";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

function exact(candidate: ChordInferenceCandidate) {
  return candidate.fit.bassMatchesInversion && candidate.fit.spellingConsistent &&
    !candidate.fit.nonChordToneNoteIds.length && !candidate.fit.omittedChordDegrees.length;
}

export function withUpperPassingTones(
  observations: readonly ChordInferenceObservation[], sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions, phraseTicks: readonly number[], ppq: number,
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  return sets.map((existing, i) => {
    const left = observations[i - 1], mid = observations[i], right = observations[i + 1];
    if (existing.length || !left || !right || mid.attackVoiceIds.length !== 1 ||
        phraseTicks.some(t => left.fromTick < t && t <= right.fromTick) ||
        [left, mid, right].some(o => observationNotes(o).some(({ note }) => note.nonChordToneRole))) return existing;
    const motion = upperPassingMotion(left, mid, right, ppq);
    if (!motion) return existing;
    const arrivals = sets[i + 1].filter(exact);
    if (!arrivals.length || arrivals.some(candidate =>
      chordIdentityToneSpellings(candidate.identity).some(t => pitchClassEquals(t, motion.note.pitch)))) return existing;
    const recovered = sets[i - 1].flatMap(anchor => {
      const { structure } = anchor.identity;
      if (!exact(anchor) || !anchor.semantics || structure.kind !== "tertian" ||
          (structure.quality !== "major" && structure.quality !== "minor") ||
          structure.extensions.length || structure.alterations.length ||
          !chordIdentityToneSpellings(anchor.identity).some(t => pitchClassEquals(t, motion.after.pitch))) return [];
      const id = motion.note.id;
      const fit = fitProlongedHarmony(anchor, mid, id);
      // The three held notes must independently retain root, third and fifth.
      if (!fit || fit.fit.omittedChordDegrees.length) return [];
      return [{
        ...fit, fit: { ...fit.fit, nonChordToneAssignments: { [id]: "passing" as const } },
        evidence: [...fit.evidence, { kind: "inferred-nonchord-tone" as const, code: "passing", noteIds: [id] }],
      }];
    });
    return recovered.length ? recovered : existing;
  });
}
