import { chordToneSpellings } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyDeclarationEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../pitch";
import { createFunctionalCandidate } from "./candidates";
import { observationNotes } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  ChordInferenceOptions,
} from "./types";

const inversions = [0, 1, 2, 3] as const;

function continuesInKey(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return left.toTick === right.fromTick && keyDeclarationEquals(left.key, right.key);
}

function hasRespelling(before: ChordInferenceObservation, pivot: ChordInferenceObservation) {
  const notes = observationNotes(before);
  return notes.every(({ voiceId, note }) => {
    const next = pivot.activeNotes[voiceId];
    return next && toMidi(note.pitch) === toMidi(next.pitch);
  }) && notes.some(({ voiceId, note }) => {
    const next = pivot.activeNotes[voiceId];
    return next && !pitchClassEquals(note.pitch, next.pitch);
  }) && before.soundingPitchClasses.some(root =>
    chordToneSpellings(root, "diminished7").every(tone =>
      before.soundingPitchClasses.some(pitch => pitchClassEquals(tone, pitch)),
    ),
  );
}

function hasExactSpelling(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.nonChordToneNoteIds.length === 0;
}

export function withWrittenPivotSevenths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
) {
  return sets.map((existing, observationIndex) => {
    const before = observations[observationIndex - 1];
    const pivot = observations[observationIndex];
    const dominant = observations[observationIndex + 1];
    const tonic = observations[observationIndex + 2];
    if (!before?.completeSatb || !pivot.completeSatb || !pivot.bass ||
        !dominant?.completeSatb || !tonic?.completeSatb || pivot.key.mode !== "major" ||
        before.toTick !== pivot.fromTick || before.key.id !== pivot.key.id ||
        !continuesInKey(pivot, dominant) || !continuesInKey(dominant, tonic) ||
        !hasRespelling(before, pivot)) return existing;

    const key = pivot.key;
    const tonicThird = scaleDegreePitchClass(key, 3);
    const hasDominant = sets[observationIndex + 1].some(candidate =>
      candidate.functionalBaseId === "D" && hasExactSpelling(candidate) &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === "dominant7" &&
      candidate.fit.omittedChordDegrees.length === 0,
    );
    const hasTonic = sets[observationIndex + 2].some(candidate =>
      candidate.functionalBaseId === "T" && hasExactSpelling(candidate) &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === "major" &&
      (pitchClassEquals(candidate.identity.bass, key.tonic) ||
        pitchClassEquals(candidate.identity.bass, tonicThird)),
    );
    if (!hasDominant || !hasTonic) return existing;

    const loweredSixth = scaleDegreePitchClass(key, 6, -1);
    const dominantRoot = scaleDegreePitchClass(key, 5);
    const notes = observationNotes(pivot);
    if (!notes.some(({ note }) => pitchClassEquals(note.pitch, loweredSixth)) ||
        !notes.every(({ voiceId, note }) => {
          const next = dominant.activeNotes[voiceId];
          if (!next) return false;
          const motion = toMidi(next.pitch) - toMidi(note.pitch);
          return pitchClassEquals(note.pitch, loweredSixth)
            ? motion === -1 && pitchClassEquals(next.pitch, dominantRoot)
            : motion === 0;
        })) return existing;

    const leadingTone = leadingTonePitchClass(key);
    const leadingNote = observationNotes(dominant).find(({ note }) =>
      pitchClassEquals(note.pitch, leadingTone),
    );
    const arrival = leadingNote && tonic.activeNotes[leadingNote.voiceId];
    if (!leadingNote || !arrival || !pitchClassEquals(arrival.pitch, key.tonic) ||
        toMidi(arrival.pitch) - toMidi(leadingNote.note.pitch) !== 1) return existing;

    const bass = pivot.bass.pitch;
    const tones = chordToneSpellings(leadingTone, "diminished7");
    const inversion = inversions.find(index => pitchClassEquals(tones[index], bass));
    if (inversion === undefined) return existing;
    const candidate = createFunctionalCandidate(pivot, {
      baseId: "DVII",
      definition: { ...functionalDefinition("DVII"), quality: () => "diminished7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion,
    }, options);
    if (candidate?.confidence !== "high" || !hasExactSpelling(candidate)) return existing;
    return [...existing, {
      ...candidate,
      id: `${candidate.id}:written-pivot-diminished7`,
      evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "written-pivot-leading-seventh" }],
    }];
  });
}
