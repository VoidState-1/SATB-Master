import { primaryHarmonyInterpretation, type ChordQuality, type ScaleDegree } from "../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { compareMetricStrength } from "../../rhythm/metric";
import { readReattackedTonicNinth } from "../writtenDominantSeventh";
import { candidateComparator, createFunctionalCandidate, fitPreparedSuspension } from "./candidates";
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

/** Recover a tonicization when the resolution triad is established one
 * event after the dominant's written target bass arrives. */
export function withReattackedTonicNinths(
  observations: readonly ChordInferenceObservation[],
  sets: readonly CandidateSet[],
  options: ChordInferenceOptions,
  phraseBoundaryTicks: readonly number[],
) {
  const result = sets.slice();
  for (let i = 0; i + 2 < observations.length; i++) {
    const [source, onset, settled] = [observations[i], observations[i + 1], observations[i + 2]];
    if ([onset, settled].some(part => part.key.id !== source.key.id || part.key.mode !== source.key.mode ||
        !pitchClassEquals(part.key.tonic, source.key.tonic)) ||
        phraseBoundaryTicks.some(tick => source.fromTick < tick && tick <= settled.fromTick) ||
        !onset.metric || !settled.metric || onset.metric.level < 2 ||
        onset.metric.measureNumber !== settled.metric.measureNumber ||
        settled.metric.beatPosition - onset.metric.beatPosition > 1 ||
        compareMetricStrength(onset.metric, settled.metric) !== "stronger") continue;
    const toFrame = ({ fromTick: tick, activeNotes: notes, completeSatb }: ChordInferenceObservation) =>
      ({ tick, notes, completeSatb });
    const proof = readReattackedTonicNinth(toFrame(source), toFrame(onset), tick =>
      tick === settled.fromTick ? toFrame(settled) : undefined);
    if (!proof || sets[i + 1].some(exactReading)) continue;
    const { tonic, mode } = proof.key;
    const anchor = sets[i + 2].find(candidate => exactReading(candidate) && candidate.fit.bassMatchesInversion &&
      candidate.identity.structure.kind === "tertian" && candidate.identity.structure.quality === mode &&
      !candidate.identity.structure.extensions.length && !candidate.identity.structure.alterations.length &&
      pitchClassEquals(candidate.identity.root, tonic) && pitchClassEquals(candidate.identity.bass, tonic));
    if (!anchor) continue;

    const hasSource = sets[i].some(candidate => exactReading(candidate) && candidate.fit.bassMatchesInversion &&
      candidate.identity.structure.kind === "tertian" && candidate.identity.structure.quality === "dominant7" &&
      !candidate.identity.structure.extensions.length && !candidate.identity.structure.alterations.length &&
      pitchClassEquals(candidate.identity.root, proof.root));
    const evidence = { kind: "sequence-context" as const, code: "reattacked-tonic-ninth-resolution",
      noteIds: [proof.repeated.id], details: { arrivalTick: onset.fromTick, confirmationTick: proof.settledTick } };
    if (!hasSource) {
      const target = [...tonicizationTargets(settled, [anchor]).keys()][0];
      if (!target) continue;
      const template = buildFunctionalTemplates(source.key).find(item =>
        item.baseId === "D" && item.form === "seventh" && item.expectedInversion === 1);
      const candidate = template && createFunctionalCandidate(source, { ...template, appliedTarget: target }, options);
      if (candidate?.confidence !== "high" || !exactReading(candidate) ||
          !pitchClassEquals(candidate.identity.root, proof.root)) continue;
      result[i] = [...result[i], { ...candidate, evidence: [...candidate.evidence, evidence] }].sort(candidateComparator);
    }
    if (options.allowNonChordToneCandidates === false || options.minConfidence === "high") continue;
    const candidate = fitPreparedSuspension(anchor, onset, [{ noteId: proof.repeated.id, figure: "9-8" }]);
    if (!candidate) continue;
    const fit = { ...candidate.fit, nonChordToneAssignments: { ...candidate.fit.nonChordToneAssignments,
      [proof.repeated.id]: "suspension" as const } };
    result[i + 1] = [...result[i + 1], { ...candidate, fit, evidence: [...candidate.evidence, evidence] }]
      .sort(candidateComparator);
  }
  return result;
}
