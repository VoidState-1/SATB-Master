import { chordIdentityEquals, chordToneSpellings, primaryHarmonyInterpretation, type KeyReference } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import { createFunctionalCandidate, createLoweredSupertonic } from "./candidates";
import type { LocalKeyContext } from "./localKeys";
import { observationNotes, resolvesTone, soundingBass } from "./observations";
import type { ChordInferenceCandidate as Candidate, ChordInferenceObservation as Observation } from "./types";

// The closing V7 or tonic may omit its fifth. Both tendency tones must resolve
// in their original registers and voices.
function authenticResolution(source: Observation, target: Observation, key: KeyReference) {
  const dominant = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  const tonic = chordToneSpellings(key.tonic, key.mode);
  return source.soundingPitchClasses.every(p => dominant.some(t => pitchClassEquals(p, t))) &&
    source.soundingPitchClasses.some(p => pitchClassEquals(p, dominant[0])) &&
    target.soundingPitchClasses.every(p => tonic.some(t => pitchClassEquals(p, t))) &&
    !!target.bass && pitchClassEquals(target.bass.pitch, tonic[0]) &&
    resolvesTone(source, target, dominant[1], tonic[0], 1) &&
    resolvesTone(source, target, dominant[3], tonic[1], -1);
}

function homeCadenceBefore(frames: readonly Observation[], pivot: Observation, boundaries: readonly number[]) {
  for (let i = pivot.index; i > 0; i--) {
    const target = frames[i], source = frames[i - 1];
    if (source.key !== pivot.key || source.localKey || source.toTick !== target.fromTick ||
        !soundingBass(source) || boundaries.some(t => source.fromTick < t && t <= target.fromTick)) break;
    if (target.soundingPitchClasses.length === 3 && source.soundingPitchClasses.length === 4 &&
        authenticResolution(source, target, pivot.key)) return source;
  }
}

function pivotReading(frame: Observation, set: readonly Candidate[], key: KeyReference) {
  const old = set[0];
  if (set.length !== 1 || frame.localKey || !soundingBass(frame) || !old.semantics ||
      old.semantics.interpretations.length !== 1 || old.semantics.alternatives?.length ||
      old.confidence !== "high" || (old.functionalBaseId !== "T" && old.functionalBaseId !== "S" &&
        old.functionalBaseId !== "D")) return;
  const local = { ...frame, key: { ...frame.key, ...key }, localKey: key };
  const root = scaleDegreePitchClass(key, 2, -1);
  const candidate = pitchClassEquals(frame.bass!.pitch, root)
    ? createLoweredSupertonic(local, "major", 0)
    : createFunctionalCandidate(local, {
        baseId: "N6", definition: functionalDefinition("N6"),
        form: "triad", expectedInversion: 1, localKeyPolicy: "current-key",
      }, {});
  if (candidate?.semantics && candidate.confidence === "high" &&
      chordIdentityEquals(old.identity, candidate.identity))
    return { candidate, semantics: candidate.semantics, source: primaryHarmonyInterpretation(old.semantics) };
}

/** §53.4. One revoiced common major triad connects two independently heard
 * keys. Its first inversion leads by step into the destination K64–V7–I. */
export function withNeapolitanPivotSixths(
  frames: readonly Observation[], sets: readonly (readonly Candidate[])[],
  localKeys: ReadonlyMap<number, LocalKeyContext>, boundaries: readonly number[],
) {
  const result = sets.slice();
  for (let i = 1; i + 3 < frames.length; i++) {
    const first = frames[i - 1], sixth = frames[i], k64 = frames[i + 1];
    const context = localKeys.get(k64.index);
    if (!context || context.dominantIndex !== i + 2 || context.tonicIndex !== i + 3 ||
        sets[i + 1].length !== 1 || sets[i + 1][0].functionalBaseId !== "K46") continue;
    const { key } = context, dominant = frames[i + 2], tonic = frames[i + 3];
    const cadence = [k64, dominant, tonic];
    if (first.key !== sixth.key || first.toTick !== sixth.fromTick ||
        cadence.some((item, n) => localKeys.get(item.index) !== context || item.key.id !== first.key.id ||
          frames[i + n].toTick !== item.fromTick || !soundingBass(item)) ||
        boundaries.some(t => first.fromTick < t && t < tonic.toTick) ||
        !spelledPitchEquals(k64.bass!.pitch, dominant.bass!.pitch) ||
        !pitchClassEquals(k64.bass!.pitch, scaleDegreePitchClass(key, 5)) ||
        !resolvesTone(k64, dominant, key.tonic, leadingTonePitchClass(key), -1) ||
        !authenticResolution(dominant, tonic, key)) continue;

    const start = pivotReading(first, sets[i - 1], key);
    const end = pivotReading(sixth, sets[i], key);
    if (!start || !end || end.candidate.functionalBaseId !== "N6" ||
        observationNotes(first).filter(({ voiceId, note }) => sixth.activeNotes[voiceId]?.id === note.id).length !== 3)
      continue;
    const tones = chordToneSpellings(end.candidate.identity.root, "major");
    const bassStep = writtenInterval(sixth.bass!.pitch, k64.bass!.pitch);
    if (bassStep.diatonicSteps !== 1 || bassStep.semitones !== 2 ||
        !resolvesTone(sixth, k64, tones[0], key.tonic, -1) ||
        !resolvesTone(sixth, k64, tones[1], scaleDegreePitchClass(key, 3), -1) ||
        !resolvesTone(sixth, k64, tones[2], k64.bass!.pitch, -1)) continue;
    const home = homeCadenceBefore(frames, first, boundaries);
    if (!home) continue;
    const evidence = { kind: "sequence-context" as const, code: "neapolitan-pivot-to-cadential-six-four",
      details: { homeDominantTick: home.fromTick, pivotTick: first.fromTick, tonicTick: tonic.fromTick },
      noteIds: [...new Set([home, frames[home.index + 1], first, sixth, ...cadence]
        .flatMap(item => observationNotes(item).map(({ note }) => note.id)))],
    };
    // The entry is the common chord. A different inversion continues in the
    // destination key; writing another pivot would assert a second modulation.
    const sameInversion = chordIdentityEquals(start.candidate.identity, end.candidate.identity);
    for (const [frame, reading] of [[first, start], [sixth, end]] as const) {
      const semantics = frame === first || sameInversion
        ? { ...reading.semantics, interpretations: [...reading.semantics.interpretations, reading.source] }
        : reading.semantics;
      result[frame.index] = [{ ...reading.candidate, semantics, evidence: [...reading.candidate.evidence, evidence] }];
    }
  }
  return result;
}
