import { primaryHarmonyInterpretation, type ChordQuality, type ScaleDegree } from "../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { candidateComparator, createFunctionalCandidate } from "./candidates";
import { buildFunctionalTemplates } from "./functionalTemplates";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions, FunctionalChordTemplate } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

function exactReading(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length && !candidate.fit.omittedChordDegrees.length;
}

function tonicizationTargets(arrival: ChordInferenceObservation, candidates: CandidateSet) {
  const targets = new Map<ScaleDegree, "major" | "minor">();
  if (arrival.soundingPitchClasses.length !== 3) return targets;
  for (const candidate of candidates) {
    const { structure, root } = candidate.identity;
    if (!candidate.semantics || !exactReading(candidate) || structure.kind !== "tertian" ||
        (structure.quality !== "major" && structure.quality !== "minor")) continue;
    const meaning = primaryHarmonyInterpretation(candidate.semantics);
    // V already has its own double-dominant templates.
    if (!meaning.appliedTarget && [2, 3, 4, 6, 7].includes(meaning.degree) &&
        pitchClassEquals(root, scaleDegreePitchClass(arrival.key, meaning.degree))) {
      targets.set(meaning.degree, structure.quality);
    }
  }
  return targets;
}

function leadingToneCandidates(
  source: ChordInferenceObservation, arrival: ChordInferenceObservation, target: ScaleDegree,
  mode: "major" | "minor", templates: readonly FunctionalChordTemplate[], options: ChordInferenceOptions,
) {
  if (source.soundingPitchClasses.length !== 4) return [];
  const tonic = scaleDegreePitchClass(source.key, target);
  const leading = leadingTonePitchClass({ tonic, mode });
  const resolves = (["soprano", "alto", "tenor", "bass"] as const).some(voice => {
    const before = source.activeNotes[voice]?.pitch, after = arrival.activeNotes[voice]?.pitch;
    return before && after && pitchClassEquals(before, leading) && pitchClassEquals(after, tonic) &&
      writtenInterval(before, after).semitones === 1;
  });
  if (!resolves) return [];
  const qualities: ChordQuality[] = mode === "major" ? ["halfDiminished7", "diminished7"] : ["diminished7"];
  const candidates: ChordInferenceCandidate[] = [];
  for (const template of templates.filter(t => t.baseId === "DVII" && t.form === "seventh")) {
    for (const quality of qualities) {
      const candidate = createFunctionalCandidate(source, {
        ...template, appliedTarget: target, definition: { ...template.definition, quality: () => quality },
      }, options);
      if (candidate?.confidence === "high" && exactReading(candidate)) {
        candidates.push(withTargetEvidence(candidate, "applied-leading-seventh-resolution", target));
      }
    }
  }
  return candidates;
}

function withTargetEvidence(candidate: ChordInferenceCandidate, code: string, target: ScaleDegree): ChordInferenceCandidate {
  return { ...candidate, evidence: [...candidate.evidence, { kind: "sequence-context", code, details: { target } }] };
}

/** A chromatic dominant is an applied reading only when its written target follows. */
export function withAppliedDominants(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[], options: ChordInferenceOptions,
) {
  const result = sets.slice();
  let continuedTarget: ScaleDegree | undefined;
  for (let i = observations.length - 2; i >= 0; i--) {
    const source = observations[i], arrival = observations[i + 1];
    const nextTarget = continuedTarget;
    continuedTarget = undefined;
    if (!source.completeSatb || !arrival.completeSatb || source.key.mode !== arrival.key.mode ||
        !pitchClassEquals(source.key.tonic, arrival.key.tonic)) continue;
    const scale = Array.from({ length: 7 }, (_, index) => scaleDegreePitchClass(source.key, index + 1));
    if (source.key.mode === "minor") scale.push(leadingTonePitchClass(source.key));
    if (source.soundingPitchClasses.every(p => scale.some(tone => pitchClassEquals(p, tone)))) continue;

    const arrivals = tonicizationTargets(arrival, sets[i + 1]);
    const targets = new Set(arrivals.keys());
    if (nextTarget) targets.add(nextTarget);
    if (!targets.size) continue;
    const templates = buildFunctionalTemplates(source.key);
    const added = [...arrivals].flatMap(([target, mode]) => leadingToneCandidates(source, arrival, target, mode, templates, options));
    const hasHomeReading = sets[i].some(exactReading);
    for (const template of templates.filter(t => t.baseId === "D" && t.form !== "ninth")) {
      // A fifth relationship alone cannot displace a well-spelled home triad.
      if (template.form === "triad" && hasHomeReading) continue;
      for (const target of targets) {
        const candidate = createFunctionalCandidate(source, { ...template, appliedTarget: target }, options);
        if (!candidate || candidate.confidence !== "high" || !exactReading(candidate)) continue;
        continuedTarget = target;
        added.push(withTargetEvidence(candidate, "applied-dominant-resolution", target));
      }
    }
    if (added.length) result[i] = [...sets[i], ...added].sort(candidateComparator);
  }
  return result;
}
