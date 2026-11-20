import { isWrittenStep, pitchClassEquals, writtenInterval } from "../../pitch";
import type { CadenceAnnotation, ProjectDocument } from "../../project";
import { cloneProject } from "../../project/selectors";
import { reconcileCadenceAnnotationStaleness } from "../../project/normalize";
import { VOICE_ORDER } from "../../project/voice";
import { buildMeasures, measureAtTick, ticksPerBeat } from "../../time";
import { detectCadences, type CadenceCandidate } from "../cadence";
import { cadenceInputs } from "../cadence/projectEvidence";
import { inferPhrases, type PhraseAnalysis } from "../phrase";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";
import type {
  ChordInferenceOptions,
  HarmonyInferenceApplyOptions,
  HarmonyInferenceApplyResult,
  HarmonyInferenceResult,
} from "./types";

function samePhraseBoundaries(
  left: readonly ProjectDocument["structure"]["phraseBoundaries"][number][],
  right: readonly ProjectDocument["structure"]["phraseBoundaries"][number][],
) {
  return (
    left.length === right.length &&
    left.every((boundary, index) => {
      const candidate = right[index];
      return (
        boundary.id === candidate.id &&
        boundary.tick === candidate.tick &&
        boundary.source === candidate.source &&
        boundary.confidence === candidate.confidence &&
        boundary.locked === candidate.locked &&
        boundary.inferenceFingerprint === candidate.inferenceFingerprint &&
        boundary.stale === candidate.stale
      );
    })
  );
}

function conflictsWithPedalContinuation(
  annotation: CadenceAnnotation,
  continuation: CadenceCandidate,
  landingTick: number,
) {
  if (annotation.stale || annotation.toTick <= continuation.fromTick ||
      continuation.toTick <= annotation.fromTick) return false;
  // Agreement is about which cadence owns the landing and release. The
  // annotated preparation and completion may express a finer reading.
  return annotation.kind !== continuation.kind ||
    (annotation.form !== undefined && annotation.form !== continuation.form) ||
    annotation.fromTick >= landingTick || annotation.toTick !== continuation.toTick;
}

function pedalContinuationMidpoint(project: ProjectDocument, phrases: PhraseAnalysis) {
  if (phrases.template.kind !== "duple") return undefined;
  const [division] = phrases.template.boundaries;
  if (division.distanceToTarget !== 0 || division.support !== "moderate" ||
      !division.evidence.some(item => item.code === "all-voices-end") ||
      project.structure.phraseBoundaries.some(boundary => boundary.source === "manual" || boundary.locked)) return undefined;

  const tick = division.tick;
  const closingMeasure = measureAtTick(buildMeasures(project), tick - 1);
  if (!closingMeasure || closingMeasure.endTick !== tick) return undefined;
  const pedal = project.satbTracks.find(track => track.id === "bass")?.notes.find(note =>
    note.startTick < closingMeasure.startTick && note.startTick + note.durationTicks === tick);
  if (!pedal || project.keyEvents.some(event => pedal.startTick < event.tick && event.tick <= tick)) return undefined;

  // Test the continuous reading without storing it. The normal detector must
  // prove the V7 resolution, held outer voices and joint final release itself.
  const analysis = cadenceInputs({
    ...project, structure: { ...project.structure, phraseBoundaries: [] },
  });
  const index = analysis.slices.findIndex(slice => slice.tick === tick);
  const before = analysis.slices[index - 1]?.notes.soprano;
  const after = analysis.slices[index]?.notes.soprano;
  if (!before || !after || before.startTick + before.durationTicks !== tick ||
      before.durationTicks > ticksPerBeat(project.ppq, closingMeasure.denominator)) return undefined;
  const soprano = writtenInterval(before.pitch, after.pitch);
  if (soprano.diatonicSteps !== -1 || !isWrittenStep(soprano)) return undefined;

  const continuation = detectCadences(analysis).find(candidate =>
    candidate.observedLandingTick === tick && candidate.evidence.some(item => item.code === "closing-tonic-revoicing"));
  if (!continuation || project.chordTrack.cadenceAnnotations.some(annotation =>
    conflictsWithPedalContinuation(annotation, continuation, tick))) return undefined;
  const hadContrastingHarmonyOverPedal = analysis.slices.some(slice => {
    const identity = slice.chord?.identity;
    return slice.tick < closingMeasure.startTick && slice.notes.bass?.id === pedal.id &&
      slice.completeSatb && identity && !pitchClassEquals(identity.root, pedal.pitch) &&
      soundsCompleteWrittenChord(identity, VOICE_ORDER.map(voice => slice.notes[voice]!), slice.notes.bass);
  });
  return hadContrastingHarmonyOverPedal ? { tick, phraseId: continuation.phraseId } : undefined;
}

function applyInferredPhraseBoundaries(project: ProjectDocument) {
  const phraseAnalysis = inferPhrases({
    ...project,
    chordRegions: project.chordTrack.regions,
  });
  const omittedMidpoint = pedalContinuationMidpoint(project, phraseAnalysis);
  const template = omittedMidpoint === undefined ? phraseAnalysis.template.kind : "single";
  const boundaries = phraseAnalysis.boundaries.filter(
    (boundary) => boundary.tick > 0 && boundary.tick < project.lengthTicks &&
      boundary.tick !== omittedMidpoint?.tick,
  );
  if (samePhraseBoundaries(project.structure.phraseBoundaries, boundaries)) {
    return {
      project,
      boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
        .length,
      template,
    };
  }
  const next = cloneProject(project);
  next.structure.phraseBoundaries = boundaries.map((boundary) => ({
    ...boundary,
  }));
  if (omittedMidpoint && project.structure.phraseBoundaries.some(boundary => boundary.tick === omittedMidpoint.tick)) {
    // Preserve the owner of a non-conflicting annotation saved under the old split.
    next.chordTrack.cadenceAnnotations = next.chordTrack.cadenceAnnotations.map(annotation =>
      !annotation.stale && phraseAnalysis.segments.some(phrase =>
        phrase.id === annotation.phraseId && phrase.fromTick <= annotation.fromTick && annotation.toTick <= phrase.toTick)
        ? { ...annotation, phraseId: omittedMidpoint.phraseId }
        : annotation);
  }
  reconcileCadenceAnnotationStaleness(next);
  next.updatedAt = new Date().toISOString();
  return {
    project: next,
    boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
      .length,
    template,
  };
}

/**
 * 创建完整和声推导的第一阶段结果。乐句依赖最终写入的和弦，
 * 因而在 applyHarmonyInference 中才计算。
 */
export function inferHarmony(
  project: ProjectDocument,
  options: ChordInferenceOptions = {},
): HarmonyInferenceResult {
  return {
    chordInference: inferChords(project, options),
  };
}

export function applyHarmonyInference(
  project: ProjectDocument,
  result: HarmonyInferenceResult,
  options: HarmonyInferenceApplyOptions,
): HarmonyInferenceApplyResult {
  const chordApplied = applyChordInference(
    project,
    result.chordInference,
    options,
  );
  const phrasesApplied = applyInferredPhraseBoundaries(chordApplied.project);
  return {
    ...chordApplied,
    project: phrasesApplied.project,
    appliedPhraseBoundaryCount: phrasesApplied.boundaryCount,
    appliedPhraseTemplate: phrasesApplied.template,
  };
}
