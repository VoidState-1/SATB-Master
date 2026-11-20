import { chordIdentityEquals, chordToneSpellings, semanticsFromChordDraft } from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { createAbsoluteCandidate } from "./candidates";
import { resolvesTone, soundingBass } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

/** In a minor key the diatonic supertonic triad is diminished. A major or
 * minor triad on that root can nevertheless be a local goal. Identify the
 * two written sonorities without inferring a key span or the goal's function
 * in the larger phrase. See Spasobin §15.2 and §32.2. */
export function withSupertonicResolutions(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[],
  options: ChordInferenceOptions, phraseBoundaries: readonly number[],
) {
  if (options.minConfidence === "high") return sets;
  const result = sets.slice();
  const needsIdentity = (set: CandidateSet) => set.every(c => !c.semantics && c.confidence === "low");
  for (let i = 0; i + 1 < observations.length; i++) {
    const source = observations[i], goal = observations[i + 1];
    if ((!needsIdentity(sets[i]) && !needsIdentity(sets[i + 1])) ||
        source.key.mode !== "minor" || goal.key.mode !== "minor" ||
        source.key.id !== goal.key.id || !pitchClassEquals(source.key.tonic, goal.key.tonic) ||
        source.toTick !== goal.fromTick || phraseBoundaries.includes(goal.fromTick) ||
        source.soundingPitchClasses.length !== 4 || goal.soundingPitchClasses.length !== 3) continue;

    const bass = soundingBass(source), goalBass = soundingBass(goal);
    if (!bass || !goalBass) continue;
    const tonic = scaleDegreePitchClass(source.key, 2);
    const dominant = scaleDegreePitchClass({ tonic, mode: "major" }, 5);
    const [root, third, fifth, seventh] = chordToneSpellings(dominant, "dominant7");
    const mode = (["major", "minor"] as const).find(quality =>
      pitchClassEquals(goalBass, chordToneSpellings(tonic, quality)[1]));
    if (!mode || !pitchClassEquals(bass, seventh) ||
        !resolvesTone(source, goal, root, root, 0) ||
        !resolvesTone(source, goal, third, tonic, 1) ||
        !resolvesTone(source, goal, fifth, tonic, -1) ||
        !resolvesTone(source, goal, seventh, goalBass, -1)) continue;

    const from = createAbsoluteCandidate(source, dominant, "dominant7", options);
    const to = createAbsoluteCandidate(goal, tonic, mode, options);
    if (!from || !to ||
        !sets[i].every(c => chordIdentityEquals(c.identity, from.identity)) ||
        !sets[i + 1].every(c => chordIdentityEquals(c.identity, to.identity))) continue;
    const evidence = { kind: "sequence-context" as const, code: "written-supertonic-resolution",
      details: { fromTick: source.fromTick, toTick: goal.fromTick } };
    const supported = (candidate: ChordInferenceCandidate): ChordInferenceCandidate => ({
      ...candidate, confidence: "medium", score: { ...candidate.score, functionalTier: 3 },
      evidence: [...candidate.evidence, evidence],
    });
    if (needsIdentity(sets[i])) result[i] = [{
      ...supported(from),
      // Its root is the raised submediant of the active minor key. This
      // literal degree leaves the target's wider function and mode open.
      semantics: semanticsFromChordDraft({
        degree: 6, degreeAlteration: 1, quality: "dominant7", inversion: 3,
        localKey: source.localKey, source: "inferred", confidence: "probable",
      }),
    }];
    // A stable local goal does not establish the home SII6 doubling rule or
    // a modulation. Preserve an existing analysis, including a double dominant.
    if (needsIdentity(sets[i + 1])) result[i + 1] = [supported(to)];
  }
  return result;
}
