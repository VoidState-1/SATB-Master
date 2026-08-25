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

function inferBoundaryCandidates(
  project: PhraseAnalysisInput,
): PhraseBoundaryCandidate[] {
  const tracks = project.satbTracks ?? [];
  if (tracks.length === 0) return [];
  const ppq = project.ppq ?? 960;
  const ticks = new Set<number>();
  tracks.forEach((track) =>
    track.notes.forEach((note) =>
      ticks.add(note.startTick + note.durationTicks),
    ),
  );
  const candidates: PhraseBoundaryCandidate[] = [];
  for (const tick of [...ticks].sort((left, right) => left - right)) {
    if (tick <= 0 || tick >= project.lengthTicks) continue;
    const evidence: PhraseEvidence[] = [];
    const allVoicesEnd = tracks.every((track) =>
      track.notes.some(
        (note) => note.startTick + note.durationTicks === tick,
      ),
    );
    if (allVoicesEnd)
      evidence.push({ code: "all-voices-end", value: "全部 SATB 声部在此处结束" });
    const silenceAfterTarget = tracks.every((track) =>
      track.notes.every(
        (note) => note.startTick < tick || note.startTick >= tick + ppq,
      ),
    );
    if (silenceAfterTarget)
      evidence.push({ code: "silence-after-target", value: "结束后至少一拍没有新起奏音符" });
    const longRelease = tracks.some(
      (track) =>
        track.notes.some(
          (note) =>
            note.startTick + note.durationTicks === tick &&
            note.durationTicks >= ppq * 2,
        ),
    );
    if (longRelease)
      evidence.push({ code: "long-note-release", value: "长时值终止音在此处释放" });
    const followingHarmony = project.chordRegions?.some(
      (region) => region.startTick === tick,
    );
    if (followingHarmony)
      evidence.push({
        code: "continuous-following-harmony",
        value: "边界后立即进入新的和声事件",
      });
    const score =
      (allVoicesEnd ? 3 : 0) +
      (silenceAfterTarget ? 2 : 0) +
      (longRelease ? 1 : 0) -
      (followingHarmony ? 3 : 0);
    if (score < 3) continue;
    candidates.push({
      tick,
      score,
      confidence: score >= 5 ? "probable" : "ambiguous",
      evidence,
    });
  }
  return candidates.filter(
    (candidate, index) =>
      index === 0 || candidate.tick - candidates[index - 1].tick >= ppq,
  );
}

/**
 * 建立结构层的第一版乐句分析。
 *
 * 当前确定性边界来自工程首尾和用户确认边界；自动推测保留为后续候选
 * 管线的扩展点，避免把节拍或和声连接误当成结构事实。
 */
export function analyzePhrases(project: PhraseAnalysisInput): PhraseAnalysis {
  const boundaries = normalizeBoundaries(project);
  const knownTicks = new Set(boundaries.map((boundary) => boundary.tick));
  const candidates = inferBoundaryCandidates(project).filter(
    (candidate) => !knownTicks.has(candidate.tick),
  );
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
