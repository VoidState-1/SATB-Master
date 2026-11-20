import { chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { fitTriadRevoicing } from "./candidates";
import { hasCompleteWrittenTertianChord } from "./fit";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation } from "./types";

function completeRevoicingSide(
  middle: ChordInferenceObservation,
  side: ChordInferenceObservation | undefined,
  boundaries: readonly number[],
) {
  if (!side?.completeSatb || !side.bass || side.soundingPitchClasses.length !== 3 ||
      side.key.id !== middle.key.id || side.key.mode !== middle.key.mode ||
      !pitchClassEquals(side.key.tonic, middle.key.tonic) ||
      Boolean(side.localKey) !== Boolean(middle.localKey)) return undefined;
  const [before, after] = side.fromTick < middle.fromTick ? [side, middle] : [middle, side];
  const seam = after.fromTick;
  if (before.toTick !== seam ||
      boundaries.some(tick => before.fromTick < tick && tick < after.toTick)) return undefined;

  const moving = VOICE_ORDER.filter(voice => side.activeNotes[voice]?.id !== middle.activeNotes[voice]?.id);
  if (moving.length !== 1 || moving[0] === "bass") return undefined;
  const voice = moving[0];
  const earlier = before.activeNotes[voice];
  const later = after.activeNotes[voice];
  if (!earlier || !later || earlier.startTick + earlier.durationTicks !== seam || later.startTick !== seam)
    return undefined;
  const steps = Math.abs(writtenInterval(earlier.pitch, later.pitch).diatonicSteps);
  if (steps < 2 || steps > 5) return undefined;

  const notes = observationNotes(side);
  const bass = toMidi(side.bass.pitch);
  if (notes.some(({ note, voiceId }) => {
    const sustained = middle.activeNotes[voiceId];
    return note.nonChordToneRole || toMidi(note.pitch) < bass ||
      (voiceId !== voice && (!sustained || !spelledPitchEquals(note.pitch, sustained.pitch)));
  }) || !hasCompleteWrittenTertianChord(side)) return undefined;
  return side === before ? { notes, fifth: earlier, replacement: later } :
    { notes, fifth: later, replacement: earlier };
}

/** Recover a root-position triad from a written fifth in a single adjacent
 * revoicing. The incomplete slice keeps the omitted degree as sounding evidence. */
export function withSingleVoiceTriadRevoicings(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  ppq: number,
  phraseBoundaryTicks: readonly number[],
) {
  return sets.map((existing, index) => {
    const middle = observations[index];
    if (existing.length || !middle.completeSatb || !middle.bass ||
        middle.soundingPitchClasses.length !== 2 || middle.toTick - middle.fromTick > ppq)
      return existing;
    const bass = toMidi(middle.bass.pitch);
    if (observationNotes(middle).some(({ note }) => note.nonChordToneRole || toMidi(note.pitch) < bass))
      return existing;

    const sides = [index - 1, index + 1].flatMap(neighbor => {
      const evidence = completeRevoicingSide(middle, observations[neighbor], phraseBoundaryTicks);
      return evidence ? [{ ...evidence, candidates: sets[neighbor] }] : [];
    });
    const recovered = new Map<string, ChordInferenceCandidate>();
    for (const { candidates, fifth, replacement } of sides) {
      for (const anchor of candidates) {
        const { root, structure } = anchor.identity;
        if (!anchor.semantics || anchor.confidence !== "high" ||
            structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "minor") ||
            structure.extensions.length || structure.alterations.length ||
            !pitchClassEquals(root, anchor.identity.bass) || !pitchClassEquals(root, middle.bass.pitch))
          continue;
        const tones = chordIdentityToneSpellings(anchor.identity);
        if (!pitchClassEquals(fifth.pitch, tones[2]) ||
            !sides.every(({ notes }) => notes.every(({ note }) =>
              tones.some(tone => pitchClassEquals(tone, note.pitch))))) continue;
        const candidate = fitTriadRevoicing(anchor, middle, [fifth.id, replacement.id]);
        if (candidate) recovered.set(JSON.stringify(candidate.semantics), candidate);
      }
    }
    return recovered.size ? [...recovered.values()] : existing;
  });
}
