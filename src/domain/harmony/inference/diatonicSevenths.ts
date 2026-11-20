import type { ScaleDegree } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { createFunctionalCandidate } from "./candidates";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;
const raisedFourth = (degree: ScaleDegree) => degrees[(degree + 2) % degrees.length];

function writtenDiatonicStack(observation: ChordInferenceObservation) {
  const { key, soundingPitchClasses: pitches } = observation;
  if (!observation.completeSatb || (pitches.length !== 3 && pitches.length !== 4) ||
    observationNotes(observation).some(({ note }) => note.nonChordToneRole)) return undefined;

  for (const degree of degrees) {
    const tones = pitches.map((_, index) =>
      scaleDegreePitchClass(key, degrees[(degree - 1 + index * 2) % degrees.length]),
    );
    if (tones.every(tone => pitches.some(pitch => pitchClassEquals(pitch, tone))))
      return { degree, tones };
  }
  return undefined;
}

function sameKeyAndAdjacent(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return (left.toTick === right.fromTick || right.toTick === left.fromTick) &&
    keyEquals(left.key, right.key);
}

function revoicesDiatonicStack(
  observations: readonly ChordInferenceObservation[],
  stacks: readonly ReturnType<typeof writtenDiatonicStack>[],
  index: number,
  direction: -1 | 1,
) {
  const source = observations[index];
  const stack = stacks[index];
  const adjacent = observations[index + direction];
  if (!stack || !adjacent || !source.bass || !sameKeyAndAdjacent(source, adjacent)) return false;

  let otherIndex = index + direction;
  if (adjacent.completeSatb && adjacent.soundingPitchClasses.length === 3 && adjacent.attackVoiceIds.length === 1 &&
    observationNotes(adjacent).every(({ note }) => !note.nonChordToneRole &&
      stack.tones.some(tone => pitchClassEquals(tone, note.pitch)))) {
    const outer = observations[index + 2 * direction];
    if (outer && sameKeyAndAdjacent(adjacent, outer)) otherIndex += direction;
  }

  const other = stacks[otherIndex];
  const otherBass = observations[otherIndex].bass;
  return other?.tones.length === 4 && other.degree === stack.degree && !!otherBass &&
    !pitchClassEquals(source.bass.pitch, otherBass.pitch);
}

/** In diatonic sequences a fully written seventh can play a local dominant-like role. */
export function withDiatonicSevenths(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
) {
  const stacks = observations.map(writtenDiatonicStack);
  return observations.map((observation, i) => {
    const existing = candidateSets[i];
    const stack = stacks[i];
    if (!stack || stack.tones.length !== 4 || !observation.bass || observation.attackVoiceIds.length < 2 ||
      (stack.degree !== 1 && stack.degree !== 3 && stack.degree !== 6)) return existing;

    const bass = observation.bass.pitch;
    const inversion = stack.tones.findIndex(tone => pitchClassEquals(bass, tone));
    const seventh = observationNotes(observation).find(({ note }) => pitchClassEquals(note.pitch, stack.tones[3]));
    if (!seventh || inversion < 0) return existing;

    const previous = observations[i - 1];
    const next = observations[i + 1];
    const before = previous && sameKeyAndAdjacent(previous, observation) ? stacks[i - 1] : undefined;
    const after = next && sameKeyAndAdjacent(observation, next) ? stacks[i + 1] : undefined;
    const continuation = after?.degree === raisedFourth(stack.degree)
      ? next.activeNotes[seventh.voiceId]
      : undefined;
    const motion = continuation && writtenInterval(seventh.note.pitch, continuation.pitch);
    const resolves = motion?.diatonicSteps === -1 && (motion.semitones === -1 || motion.semitones === -2);
    const predecessor = before?.tones.length === 4 && raisedFourth(before.degree) === stack.degree
      ? previous.activeNotes[seventh.voiceId]
      : undefined;
    const prepared = predecessor && after?.degree === stack.degree &&
      seventh.note.startTick === observation.fromTick &&
      pitchClassEquals(predecessor.pitch, seventh.note.pitch) &&
      predecessor.pitch.octave === seventh.note.pitch.octave;
    const revoiced = revoicesDiatonicStack(observations, stacks, i, -1) ||
      revoicesDiatonicStack(observations, stacks, i, 1);
    if (!resolves && !prepared && !revoiced) return existing;

    const major = observation.key.mode === "major";
    const baseId = stack.degree === 1 ? (major ? "T" : "t")
      : stack.degree === 3 ? (major ? "DTIII" : "dtIII") : "TSVI";
    const majorSeventh = stack.degree === 1 ? major : !major;
    const quality = majorSeventh ? "major7" : "minor7";
    const definition = functionalDefinition(baseId);
    const candidate = createFunctionalCandidate(observation, {
      baseId,
      definition: { ...definition, forms: ["seventh"], quality: () => quality },
      form: "seventh",
      localKeyPolicy: "current-key",
      expectedInversion: inversion as 0 | 1 | 2 | 3,
    }, options);
    if (!candidate || candidate.confidence !== "high") return existing;
    return [{ ...candidate, evidence: [...candidate.evidence, {
      kind: "sequence-context" as const,
      code: "diatonic-seventh-sequence",
      details: { degree: stack.degree, resolves, prepared: Boolean(prepared), revoiced: Boolean(revoiced) },
    }] }, ...existing];
  });
}
