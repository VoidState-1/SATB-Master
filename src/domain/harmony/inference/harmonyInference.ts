import type { ProjectDocument } from "../../project";
import { cloneProject } from "../../project/selectors";
import { inferPhrases } from "../phrase";
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

function applyInferredPhraseBoundaries(project: ProjectDocument) {
  const phraseAnalysis = inferPhrases({
    ...project,
    chordRegions: project.chordTrack.regions,
  });
  const boundaries = phraseAnalysis.boundaries.filter(
    (boundary) => boundary.tick > 0 && boundary.tick < project.lengthTicks,
  );
  if (samePhraseBoundaries(project.structure.phraseBoundaries, boundaries)) {
    return {
      project,
      boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
        .length,
      template: phraseAnalysis.template.kind,
    };
  }
  const next = cloneProject(project);
  next.structure.phraseBoundaries = boundaries.map((boundary) => ({
    ...boundary,
  }));
  next.updatedAt = new Date().toISOString();
  return {
    project: next,
    boundaryCount: boundaries.filter((boundary) => boundary.source === "inferred")
      .length,
    template: phraseAnalysis.template.kind,
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
