import type { PhraseAnalysisInput, PhraseBoundary } from "./types";

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/**
 * 乐句结构依赖节奏、音符与和弦解释，而不依赖工程标题或规则配置。
 * 它只用于判断自动推导结果是否仍可被视为当前输入的产物，不作持久化 ID。
 */
export function phraseInferenceFingerprint(project: PhraseAnalysisInput) {
  const chordRegions = project.chordRegions ?? project.chordTrack?.regions ?? [];
  return hash(
    stableJson({
      ppq: project.ppq,
      lengthTicks: project.lengthTicks,
      meterEvents: [...(project.meterEvents ?? [])].sort(
        (left, right) => left.tick - right.tick,
      ),
      satbTracks: [...(project.satbTracks ?? [])]
        .map((track) => ({
          id: track.id,
          notes: [...track.notes].sort(
            (left, right) =>
              left.startTick - right.startTick ||
              left.durationTicks - right.durationTicks ||
              (left.id ?? "").localeCompare(right.id ?? ""),
          ),
        }))
        .sort((left, right) =>
          (left.id ?? stableJson(left)).localeCompare(
            right.id ?? stableJson(right),
          ),
        ),
      chordRegions: [...chordRegions].sort(
        (left, right) =>
          left.startTick - right.startTick || left.id.localeCompare(right.id),
      ),
    }),
  );
}

export function isCurrentPhraseBoundary(
  project: PhraseAnalysisInput,
  boundary: PhraseBoundary,
) {
  return (
    boundary.source === "manual" ||
    (!boundary.stale &&
      Boolean(boundary.inferenceFingerprint) &&
      boundary.inferenceFingerprint === phraseInferenceFingerprint(project))
  );
}
