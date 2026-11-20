import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyDeclarationEquals, isWrittenStep, pitchClassEquals, toMidi, writtenInterval, type SpelledPitch } from "../../pitch";
import { compareMetricStrength } from "../../rhythm/metric";
import { createFunctionalCandidate } from "./candidates";
import { observationNotes } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  ChordInferenceOptions,
} from "./types";

function exactFit(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.omittedChordDegrees.length;
}

function descendsByStep(from: SpelledPitch, to: SpelledPitch) {
  const interval = writtenInterval(from, to);
  return interval.diatonicSteps === -1 && interval.semitones < 0 && isWrittenStep(interval);
}

/** Spasobin §38.4, ex. 38–574: a passing tone can be the written seventh
 * of the prolonged chord. Here the actual bass supplies that seventh. */
export function withPassingTonicSevenths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  phraseBoundaryTicks: readonly number[],
) {
  return sets.map((existing, i) => {
    const before = observations[i - 1];
    const middle = observations[i];
    const after = observations[i + 1];
    if (!before?.bass || !middle.bass || !after?.bass ||
        !before.completeSatb || !middle.completeSatb || !after.completeSatb ||
        before.toTick !== middle.fromTick || middle.toTick !== after.fromTick ||
        !keyDeclarationEquals(before.key, middle.key) || !keyDeclarationEquals(middle.key, after.key) ||
        phraseBoundaryTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        middle.soundingPitchClasses.length !== 4 ||
        compareMetricStrength(middle.metric, before.metric) !== "weaker" ||
        before.bass.nonChordToneRole || after.bass.nonChordToneRole ||
        middle.bass.startTick !== middle.fromTick || after.bass.startTick !== after.fromTick ||
        middle.toTick - middle.fromTick > before.toTick - before.fromTick ||
        !descendsByStep(before.bass.pitch, middle.bass.pitch) ||
        !descendsByStep(middle.bass.pitch, after.bass.pitch)) return existing;

    if ([before, middle, after].some(side =>
      observationNotes(side).some(({ note }) => note.nonChordToneRole ||
        toMidi(note.pitch) < toMidi(side.bass!.pitch)))) return existing;
    if (observationNotes(middle).some(({ voiceId, note }) =>
      voiceId !== "bass" && before.activeNotes[voiceId]?.id !== note.id)) return existing;

    const major = middle.key.mode === "major";
    const baseId = major ? "T" : "t";
    const root = middle.key.tonic;
    if (!sets[i - 1].some(candidate => candidate.functionalBaseId === baseId &&
      candidate.identity.structure.kind === "tertian" &&
      candidate.identity.structure.quality === (major ? "major" : "minor") &&
      pitchClassEquals(candidate.identity.bass, root) && exactFit(candidate)) ||
        !sets[i + 1].some(candidate => candidate.identity.structure.kind === "tertian" &&
          candidate.semantics && exactFit(candidate))) return existing;

    const definition = functionalDefinition(baseId);
    const candidate = createFunctionalCandidate(middle, {
      baseId,
      definition: { ...definition, forms: ["seventh"], quality: () => major ? "major7" : "minor7" },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: 3,
    }, options);
    if (!candidate || !exactFit(candidate) ||
        existing.some(other => other.id === candidate.id)) return existing;
    return [...existing, {
      ...candidate,
      evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "passing-tonic-seventh" }],
    }];
  });
}
