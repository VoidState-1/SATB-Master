import { chordToneSpellings, type KeyReference } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { pitchClassEquals, pitchClassValue, scaleDegreePitchClass } from "../../pitch";
import { readWrittenDominantSeventh } from "../writtenDominantSeventh";
import { createFunctionalCandidate } from "./candidates";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;

function sameContext(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return left.toTick === right.fromTick && left.key.id === right.key.id &&
    left.key.mode === right.key.mode && pitchClassEquals(left.key.tonic, right.key.tonic);
}

/** In harmonic major the lowered sixth gives iiø7 (§21.1) or the
 * diminished supertonic in first inversion (§19.1). */
export function harmonicMajorPreparation(item: ChordInferenceObservation, next: ChordInferenceObservation, key: KeyReference) {
  if (key.mode !== "major" || !item.completeSatb || !next.completeSatb || !item.bass || !next.bass ||
      ![3, 4].includes(item.soundingPitchClasses.length) || observationNotes(item).some(({ note }) => note.nonChordToneRole)) return;
  const quality: "halfDiminished7" | "diminished" = item.soundingPitchClasses.length === 4 ? "halfDiminished7" : "diminished";
  const ii = chordToneSpellings(scaleDegreePitchClass(key, 2), quality);
  if (!ii.every(tone => item.soundingPitchClasses.some(p => pitchClassEquals(p, tone)))) return;
  const inversion = ii.findIndex(tone => pitchClassEquals(tone, item.bass!.pitch)) as 0 | 1 | 2 | 3;
  if (quality === "diminished" && inversion !== 1) return;
  const dominant = scaleDegreePitchClass(key, 5);
  const exactTriad = (tones: ReturnType<typeof chordToneSpellings>) =>
    tones.every(tone => next.soundingPitchClasses.some(p => pitchClassEquals(p, tone))) &&
    next.soundingPitchClasses.length === tones.length;
  const seventh = readWrittenDominantSeventh(next.activeNotes);
  if (seventh && pitchClassEquals(seventh.root, dominant) ||
      exactTriad(chordToneSpellings(dominant, "major")) ||
      pitchClassEquals(next.bass.pitch, dominant) && inversion !== 3 && exactTriad(chordToneSpellings(key.tonic, "major")))
    return { inversion, quality };
}

/** Recognize a sequence only after two consecutive fourth-related root
 * changes. The written sonority of each link supplies its root and quality;
 * the link alone does not establish a new key. */
export function withAppliedSequences(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
) {
  const stacks = observations.map(item => readWrittenDominantSeventh(item.activeNotes));
  const chain = new Set<number>();
  let start = 0, links = 0;
  for (let i = 0; i < stacks.length; i++) {
    const current = stacks[i], next = stacks[i + 1];
    if (current && next && sameContext(observations[i], observations[i + 1])) {
      if (pitchClassEquals(current.root, next.root)) continue;
      if (pitchClassValue(current.target) === pitchClassValue(next.root)) {
        links++;
        if (links >= 2) {
          for (let j = start; j <= i; j++) chain.add(j);
          start = i + 1;
        }
        continue;
      }
    }
    start = i + 1;
    links = 0;
  }
  return observations.map((item, i) => {
    const existing = sets[i];
    const next = observations[i + 1];
    if (next && sameContext(item, next)) {
      const prep = harmonicMajorPreparation(item, next, item.key);
      if (prep) {
        const chord = createFunctionalCandidate(item, {
          baseId: "SII", definition: { ...functionalDefinition("SII"), quality: () => prep.quality },
          form: prep.quality === "diminished" ? "triad" : "seventh",
          expectedInversion: prep.inversion, localKeyPolicy: "current-key",
        }, options);
        if (chord) return [...existing, { ...chord, id: chord.id + ":harmonic-major", evidence: [...chord.evidence,
          { kind: "sequence-context" as const, code: "harmonic-major-supertonic" }] }];
      }
    }
    const stack = stacks[i];
    if (!stack || !chain.has(i)) return existing;
    // At an enharmonic pivot the source spelling still determines the written
    // target (e.g. Db7 points to Gb even if the next root is spelled F#).
    const target = degrees.find(degree => pitchClassEquals(scaleDegreePitchClass(item.key, degree), stack.target));
    const matching = existing.find(c => c.functionalBaseId && c.fit.spellingConsistent &&
      c.identity.structure.kind === "tertian" && c.identity.structure.quality === "dominant7" &&
      pitchClassEquals(c.identity.root, stack.root));
    const local = target ? item : { ...item, key: { ...item.key, tonic: stack.target, mode: "major" as const }, localKey: undefined };
    const chord = matching ?? createFunctionalCandidate(local, {
      baseId: "D", definition: functionalDefinition("D"), form: "seventh", expectedInversion: stack.inversion,
      localKeyPolicy: "current-key", appliedTarget: target === 1 ? undefined : target,
    }, { ...options, allowIncompleteVoicing: true });
    if (!chord || options.minConfidence === "high" && chord.confidence !== "high") return existing;
    const candidate = { ...chord,
      // Applied targets in the document format carry a diatonic degree only.
      // Keep the absolute identity and resolution evidence for a chromatic target.
      ...(!target && !matching ? { semantics: undefined, functionalBaseId: undefined } : {}),
      evidence: [...chord.evidence, { kind: "sequence-context" as const, code: "dominant-seventh-chain",
        details: { targetStep: stack.target.step, targetAlter: stack.target.alter } }],
    };
    return [candidate, ...existing.filter(c => c !== matching && c.fit.spellingConsistent)];
  });
}
