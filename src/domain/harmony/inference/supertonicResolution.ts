import { chordIdentityEquals, semanticsFromChordDraft, type KeyReference, type ScaleDegree } from "../../chordModel";
import { keyDeclarationEquals, pitchClassEquals, scaleDegreePitchClass, stepIndex, type Alteration } from "../../pitch";
import { createAbsoluteCandidate } from "./candidates";
import { adjacentTonicAnchor, writtenThirdInversion } from "./thirdInversionAnchors";
import type { ChordInferenceCandidate as Candidate, ChordInferenceObservation as Observation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly Candidate[];

function needsIdentity(set: CandidateSet) {
  return set.every(c => !c.semantics && c.confidence === "low");
}

function sameContext(source: Observation, end: Observation) {
  return keyDeclarationEquals(source.key, end.key);
}

function literalDominant(item: Observation, key: KeyReference, options: ChordInferenceOptions, inversion: 2 | 3) {
  const root = scaleDegreePitchClass(key, 5);
  const candidate = createAbsoluteCandidate(item, root, "dominant7", options);
  if (!candidate) return;
  const degree = (1 + (stepIndex(root.step) - stepIndex(item.key.tonic.step) + 7) % 7) as ScaleDegree;
  const diatonicRoot = scaleDegreePitchClass(item.key, degree);
  const alteration = root.alter - diatonicRoot.alter;
  if (diatonicRoot.step !== root.step || Math.abs(alteration) > 2) return candidate;
  return { ...candidate, semantics: semanticsFromChordDraft({
    degree, degreeAlteration: alteration as Alteration, quality: "dominant7", inversion,
    localKey: item.localKey, source: "inferred", confidence: "probable",
  }) };
}

export function withThirdInversionResolutions(
  frames: readonly Observation[], sets: readonly CandidateSet[], options: ChordInferenceOptions, boundaries: readonly number[],
) {
  if (options.minConfidence === "high") return sets;
  const result = sets.slice();
  const connected = (i: number, end: number) =>
    frames.slice(i, end + 1).every((f, offset) => sameContext(frames[i], f) &&
      (!offset || frames[i + offset - 1].toTick === f.fromTick)) &&
    !boundaries.some(t => frames[i].fromTick < t && t <= frames[end].fromTick);
  for (let i = 0; i + 1 < frames.length; i++) {
    const source = frames[i], goal = frames[i + 1];
    if ((!needsIdentity(result[i]) && !needsIdentity(result[i + 1])) || !connected(i, i + 1)) continue;
    const key = writtenThirdInversion(source, goal);
    if (!key) continue;
    const homeSupertonic = source.key.mode === "minor" && pitchClassEquals(key.tonic, scaleDegreePitchClass(source.key, 2));
    const anchor = adjacentTonicAnchor(frames, i, key, connected);
    if (!homeSupertonic && !anchor) continue;

    // Keep the existing single-pair contract on the home minor supertonic.
    // Other targets require an independently voiced return to a root-position tonic.
    const sourceChord = literalDominant(source, key, options, 3);
    // Keep the local tonic role in the proof. A literal degree on this triad
    // would also assert home-key doubling or progression obligations.
    const tonicChord = (j: number) => createAbsoluteCandidate(frames[j], key.tonic, key.mode, options);
    const readings = [{ j: i, candidate: sourceChord, role: "D2" },
      { j: i + 1, candidate: tonicChord(i + 1), role: "T6" }];
    // Revoicing over the same bass belongs to the witnessed I6. The passing
    // V64 is evidence only: a bare 64 would leave its doubling unexplained.
    if (anchor && anchor.dominant > i) {
      for (let j = i + 2; j < anchor.dominant; j++) readings.push({ j, candidate: tonicChord(j), role: "T6" });
    }
    if (anchor && anchor.kind !== "passing-six-four") {
      readings.push({ j: anchor.dominant, candidate: literalDominant(frames[anchor.dominant], key, options, 2), role: "D43" },
        { j: anchor.tonic, candidate: tonicChord(anchor.tonic), role: "T" });
    }
    if (!readings.every(({ j, candidate }) => candidate && result[j].every(c => chordIdentityEquals(c.identity, candidate.identity)))) continue;
    for (const { j, candidate, role } of readings) {
      if (!candidate || !needsIdentity(result[j])) continue;
      const evidence = { kind: "sequence-context" as const, code: homeSupertonic ? "written-supertonic-resolution" : "written-third-inversion-return",
        details: { fromTick: source.fromTick, toTick: goal.fromTick, ...(anchor ? {
          anchor: anchor.kind, dominantTick: frames[anchor.dominant].fromTick, rootTonicTick: frames[anchor.tonic].fromTick,
          tonicStep: key.tonic.step, tonicAlter: key.tonic.alter, mode: key.mode, role,
        } : {}) } };
      result[j] = [{ ...candidate, confidence: "medium", score: { ...candidate.score, functionalTier: 3 },
        evidence: [...candidate.evidence, evidence] }];
    }
  }
  return result;
}
