import { chordToneSpellings } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../pitch";
import { createFunctionalCandidate } from "./candidates";
import type { LocalKeyContext } from "./localKeys";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type Observation = ChordInferenceObservation;
type CandidateSet = readonly ChordInferenceCandidate[];
const inversions = [0, 1, 2, 3] as const;

function exact(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.omittedChordDegrees.length &&
    !candidate.fit.nonChordToneNoteIds.length;
}

function hasWrittenLowestBass(item: Observation) {
  const bass = item.bass;
  if (!bass) return false;
  const lowest = toMidi(bass.pitch);
  return observationNotes(item).every(({ note }) => toMidi(note.pitch) >= lowest);
}

/** Spasobin §57.8a permits a written vii°7 to resolve straight to the new
 * tonic. The ensuing independently inferred V–I must confirm that key. */
export function withLeadingSeventhIntoConfirmedKey(
  observations: readonly Observation[],
  sets: readonly CandidateSet[],
  options: ChordInferenceOptions,
  contexts: ReadonlyMap<number, LocalKeyContext>,
  phraseBoundaries: readonly number[],
) {
  return sets.map((existing, i) => {
    const source = observations[i], arrival = observations[i + 1];
    const sourceBass = source.bass?.pitch;
    if (!arrival || !source.completeSatb || !sourceBass || source.localKey ||
        source.soundingPitchClasses.length !== 4 || existing.some(exact) ||
        observationNotes(source).some(({ note }) => note.nonChordToneRole)) return existing;

    const tonicBass = arrival.bass;
    if (!tonicBass || source.toTick !== arrival.fromTick || arrival.key.id !== source.key.id) return existing;
    const bassEnd = tonicBass.startTick + tonicBass.durationTicks;
    const tonicNotes = observationNotes(arrival).filter(({ note }) =>
      !note.nonChordToneRole && note.startTick + note.durationTicks >= bassEnd);
    if (tonicNotes.length < 3) return existing;
    let j = i + 2;
    while (j < observations.length) {
      const frame = observations[j];
      if (frame.bass?.id !== tonicBass.id) break;
      j++;
    }

    const dominantOnset = observations[j];
    const bass = dominantOnset?.bass;
    if (!bass || dominantOnset.fromTick !== bassEnd || dominantOnset.key.id !== source.key.id) return existing;
    // The dominant itself can begin with a written rest in the upper voice.
    // Look up the key proven by the existing pipeline within this bass event.
    let proof: LocalKeyContext | undefined;
    for (let k = j; k < observations.length && observations[k].key.id === source.key.id &&
      observations[k].bass?.id === bass.id; k++) {
      proof = contexts.get(k);
      if (proof) break;
    }
    if (!proof || proof.dominantIndex < j || proof.tonicIndex <= proof.dominantIndex ||
        observations.slice(i, proof.tonicIndex + 1).some(frame =>
          frame.key.id !== source.key.id || !hasWrittenLowestBass(frame)) ||
        phraseBoundaries.some(tick => source.fromTick < tick && tick <= observations[proof.tonicIndex].fromTick))
      return existing;
    const key = proof.key;
    if (keyEquals(source.key, key) || (arrival.localKey && !keyEquals(arrival.localKey, key)) ||
        !pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, 5))) return existing;

    const dominantNotes = observationNotes(dominantOnset).filter(({ note }) => !note.nonChordToneRole);
    const dominant = chordToneSpellings(bass.pitch, "major");
    if (!dominant.every(tone => dominantNotes.some(({ note }) => pitchClassEquals(note.pitch, tone))))
      return existing;
    const tonic = chordToneSpellings(key.tonic, key.mode);
    if (!tonic.every(tone => tonicNotes.some(({ note }) => pitchClassEquals(note.pitch, tone))) ||
        ![tonic[0], tonic[1]].some(tone => pitchClassEquals(tone, tonicBass.pitch)) ||
        observationNotes(arrival).some(({ note }) =>
          note.nonChordToneRole || !tonic.some(tone => pitchClassEquals(note.pitch, tone)))) return existing;
    const leading = leadingTonePitchClass(key);
    const leadingNote = observationNotes(source).find(({ note }) => pitchClassEquals(note.pitch, leading));
    const resolved = leadingNote && arrival.activeNotes[leadingNote.voiceId];
    if (!leadingNote || !resolved || leadingNote.note.startTick + leadingNote.note.durationTicks !== arrival.fromTick ||
        resolved.startTick !== arrival.fromTick || !pitchClassEquals(resolved.pitch, key.tonic)) return existing;
    const motion = writtenInterval(leadingNote.note.pitch, resolved.pitch);
    if (motion.diatonicSteps !== 1 || motion.semitones !== 1) return existing;

    const tones = chordToneSpellings(leading, "diminished7");
    const inversion = inversions.find(value => pitchClassEquals(sourceBass, tones[value]));
    if (inversion === undefined) return existing;
    const candidate = createFunctionalCandidate({ ...source, key: { ...source.key, ...key }, localKey: key }, {
      baseId: "DVII",
      definition: { ...functionalDefinition("DVII"), quality: () => "diminished7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion,
    }, options);
    if (!candidate || !exact(candidate)) return existing;
    // Every previous reading required missing or foreign tones, or contradicted
    // the spelling. All four written members and the later cadence agree here.
    return [{ ...candidate, evidence: [...candidate.evidence, {
      kind: "sequence-context" as const, code: "written-leading-seventh-into-confirmed-key",
      details: { arrivalTick: arrival.fromTick, dominantTick: observations[proof.dominantIndex].fromTick,
        tonicTick: observations[proof.tonicIndex].fromTick },
    }] }];
  });
}
