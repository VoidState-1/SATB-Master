import type {
  PhraseAnalysis,
  PhraseBoundary,
  PhraseBoundaryCandidate,
  PhraseConfidence,
  PhraseEvidence,
  PhraseAnalysisInput,
  PhraseSegment,
} from "./types";

const confidenceRank: Record<PhraseConfidence, number> = {
  ambiguous: 0,
  probable: 1,
  certain: 2,
};

function boundaryId(tick: number) {
  return `phrase-boundary-${tick}`;
}

function endpointBoundary(
  tick: number,
  code: "project-start" | "project-end",
): PhraseBoundary {
  return {
    id: boundaryId(tick),
    tick,
    source: "inferred",
    confidence: "certain",
  };
}

function normalizeBoundaries(project: PhraseAnalysisInput): PhraseBoundary[] {
  const supplied = project.structure?.phraseBoundaries ?? [];
  const byTick = new Map<number, PhraseBoundary>();
  for (const boundary of supplied) {
    if (!Number.isInteger(boundary.tick)) continue;
    const tick = Math.max(0, Math.min(project.lengthTicks, boundary.tick));
    if (tick === 0 || tick === project.lengthTicks) continue;
    const previous = byTick.get(tick);
    if (
      !previous ||
      confidenceRank[boundary.confidence] > confidenceRank[previous.confidence]
    ) {
      byTick.set(tick, { ...boundary, tick });
    }
  }
  return [
    endpointBoundary(0, "project-start"),
    ...[...byTick.values()].sort((left, right) => left.tick - right.tick),
    endpointBoundary(project.lengthTicks, "project-end"),
  ];
}

function boundaryEvidence(boundary: PhraseBoundary): PhraseEvidence[] {
  if (boundary.tick === 0)
    return [{ code: "project-start", value: "工程起点" }];
  if (boundary.source === "manual")
    return [
      {
        code: "manual-boundary",
        value: "用户确认的乐句边界",
        refs: [boundary.id],
      },
    ];
  return [{ code: "project-end", value: "工程终点" }];
}

function segmentSource(
  startBoundary: PhraseBoundary,
  endBoundary: PhraseBoundary,
): PhraseSegment["source"] {
  const sources = new Set([startBoundary.source, endBoundary.source]);
  if (sources.size === 1) return [...sources][0];
  return "mixed";
}

function segmentConfidence(
  startBoundary: PhraseBoundary,
  endBoundary: PhraseBoundary,
): PhraseConfidence {
  return confidenceRank[startBoundary.confidence] <=
    confidenceRank[endBoundary.confidence]
    ? startBoundary.confidence
    : endBoundary.confidence;
}

function buildSegments(boundaries: readonly PhraseBoundary[]): PhraseSegment[] {
  const segments: PhraseSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startBoundary = boundaries[index];
    const endBoundary = boundaries[index + 1];
    if (endBoundary.tick <= startBoundary.tick) continue;
    segments.push({
      id: `phrase-${startBoundary.tick}-${endBoundary.tick}`,
      fromTick: startBoundary.tick,
      toTick: endBoundary.tick,
      startBoundary,
      endBoundary,
      source: segmentSource(startBoundary, endBoundary),
      confidence: segmentConfidence(startBoundary, endBoundary),
      evidence: [
        ...boundaryEvidence(startBoundary),
        ...boundaryEvidence(endBoundary),
      ],
    });
  }
  return segments;
}

/**
 * 建立结构层的第一版乐句分析。
 *
 * 当前确定性边界来自工程首尾和用户确认边界；自动推测保留为后续候选
 * 管线的扩展点，避免把节拍或和声连接误当成结构事实。
 */
export function analyzePhrases(project: PhraseAnalysisInput): PhraseAnalysis {
  const boundaries = normalizeBoundaries(project);
  const candidates: PhraseBoundaryCandidate[] = [];
  const segments = buildSegments(boundaries);
  return {
    boundaries: Object.freeze(boundaries),
    candidates: Object.freeze(candidates),
    segments: Object.freeze(segments),
  };
}

export function phraseAtTick(
  segments: readonly PhraseSegment[],
  tick: number,
) {
  return segments.find(
    (segment) => segment.fromTick <= tick && tick < segment.toTick,
  );
}
