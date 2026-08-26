import type {
  PhraseAnalysis,
  PhraseBoundary,
  PhraseBoundaryCandidate,
  PhraseConfidence,
  PhraseEvidence,
  PhraseAnalysisInput,
  PhraseAnalysisOptions,
  PhraseSegment,
} from "./types";
import {
  chordStructureQuality,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { buildMetricTimeline, metricPositionAt } from "../../rhythm/metric";
import type { ChordRegion } from "../../project/types";
import {
  isCurrentPhraseBoundary,
  phraseInferenceFingerprint,
} from "./fingerprint";

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

function normalizeBoundaries(
  project: PhraseAnalysisInput,
  options: PhraseAnalysisOptions = {},
): PhraseBoundary[] {
  const supplied = (project.structure?.phraseBoundaries ?? []).filter(
    (boundary) =>
      (!options.replaceInferredBoundaries || boundary.source === "manual") &&
      isCurrentPhraseBoundary(project, boundary),
  );
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

function functionalFamily(region: ChordRegion | undefined): FunctionalFamily | undefined {
  if (!region?.semantics) return undefined;
  const confidence = harmonySemanticsConfidence(region.semantics);
  const interpretation = primaryHarmonyInterpretation(region.semantics);
  if (
    confidence === "ambiguous" ||
    confidence === "unknown" ||
    Boolean(interpretation.appliedTarget)
  )
    return undefined;
  return effectiveFunctionalDesignation(
    region.semantics,
    chordStructureQuality(region.identity),
  )?.primaryFunction;
}

function terminalRegionAt(
  regions: readonly ChordRegion[],
  tick: number,
) {
  return regions.find((region) => region.startTick + region.durationTicks === tick);
}

function precedingRegion(
  regions: readonly ChordRegion[],
  region: ChordRegion | undefined,
) {
  return region
    ? regions.find((candidate) => candidate.startTick + candidate.durationTicks === region.startTick)
    : undefined;
}

function followingRegion(
  regions: readonly ChordRegion[],
  tick: number,
) {
  return regions.find((region) => region.startTick === tick);
}

function candidateTicks(project: PhraseAnalysisInput) {
  const ticks = new Set<number>();
  project.satbTracks?.forEach((track) =>
    track.notes.forEach((note) => ticks.add(note.startTick + note.durationTicks)),
  );
  (project.chordRegions ?? project.chordTrack?.regions ?? []).forEach((region) =>
    ticks.add(region.startTick + region.durationTicks),
  );
  return [...ticks].sort((left, right) => left - right);
}

function minimumBoundarySpacingAt(
  project: PhraseAnalysisInput,
  tick: number,
) {
  const timeline =
    project.ppq && project.meterEvents
      ? buildMetricTimeline({
          ppq: project.ppq,
          meterEvents: project.meterEvents,
          lengthTicks: project.lengthTicks,
        })
      : undefined;
  const measure = timeline?.measures.find(
    (candidate) =>
      candidate.startTick === tick ||
      (candidate.startTick < tick && tick <= candidate.endTick),
  );
  return measure ? measure.endTick - measure.startTick : project.ppq ?? 960;
}

/**
 * 为自动边界执行保守的频率约束：相邻边界至少间隔一个完整小节。
 * 高分的结构终点可以替换同一局部窗口中较弱的候选，避免每次和声变换都切分乐句。
 */
function selectBoundaryCandidates(
  project: PhraseAnalysisInput,
  candidates: readonly PhraseBoundaryCandidate[],
) {
  const selected: PhraseBoundaryCandidate[] = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (!previous) {
      selected.push(candidate);
      continue;
    }
    const minimumSpacing = minimumBoundarySpacingAt(project, previous.tick);
    if (candidate.tick - previous.tick >= minimumSpacing) {
      selected.push(candidate);
      continue;
    }
    if (candidate.score > previous.score) selected[selected.length - 1] = candidate;
  }
  return selected;
}

function inferBoundaryCandidates(
  project: PhraseAnalysisInput,
): PhraseBoundaryCandidate[] {
  const tracks = project.satbTracks ?? [];
  const regions = [
    ...(project.chordRegions ?? project.chordTrack?.regions ?? []),
  ].sort(
    (left, right) => left.startTick - right.startTick,
  );
  if (tracks.length === 0 && regions.length === 0) return [];
  const ppq = project.ppq ?? 960;
  const timeline =
    project.ppq && project.meterEvents
      ? buildMetricTimeline({
          ppq: project.ppq,
          meterEvents: project.meterEvents,
          lengthTicks: project.lengthTicks,
        })
      : undefined;
  const candidates: PhraseBoundaryCandidate[] = [];
  for (const tick of candidateTicks(project)) {
    if (tick <= 0 || tick >= project.lengthTicks) continue;
    const evidence: PhraseEvidence[] = [];
    const allVoicesEnd =
      tracks.length > 0 &&
      tracks.every((track) =>
        track.notes.some((note) => note.startTick + note.durationTicks === tick),
      );
    if (allVoicesEnd)
      evidence.push({ code: "all-voices-end", value: "全部 SATB 声部在此处结束" });
    const silenceAfterTarget =
      tracks.length > 0 &&
      tracks.every((track) =>
        track.notes.every(
          (note) => note.startTick < tick || note.startTick >= tick + ppq,
        ),
      );
    if (silenceAfterTarget)
      evidence.push({
        code: "silence-after-target",
        value: "结束后至少一拍没有新起奏音符",
      });
    const longRelease = tracks.some((track) =>
      track.notes.some(
        (note) =>
          note.startTick + note.durationTicks === tick &&
          note.durationTicks >= ppq * 2,
      ),
    );
    if (longRelease)
      evidence.push({ code: "long-note-release", value: "长时值终止音在此处释放" });

    const terminal = terminalRegionAt(regions, tick);
    const previous = precedingRegion(regions, terminal);
    const following = followingRegion(regions, tick);
    const terminalFamily = functionalFamily(terminal);
    const previousFamily = functionalFamily(previous);
    const followingFamily = functionalFamily(following);
    const stableTerminal = Boolean(terminalFamily);
    if (stableTerminal)
      evidence.push({ code: "stable-harmony", value: "末端具有确定功能和声" });
    if (terminalFamily === "dominant")
      evidence.push({
        code: "cadential-connection",
        value: "属功能位于潜在乐句末端",
      });
    if (
      previousFamily === "dominant" &&
      terminalFamily === "tonic"
    )
      evidence.push({
        code: "cadential-connection",
        value: "当前调性 D -> T 收束",
      });
    if (
      previousFamily === "subdominant" &&
      terminalFamily === "tonic"
    )
      evidence.push({
        code: "cadential-connection",
        value: "当前调性 S -> T 收束",
      });
    const metric = timeline ? metricPositionAt(timeline, tick) : undefined;
    if (metric && metric.level >= 2 && metric.confidence === "certain")
      evidence.push({
        code: "metric-support",
        value: metric.role === "downbeat" ? "位于小节线" : "位于次强拍",
      });
    if (following && followingFamily && followingFamily !== terminalFamily)
      evidence.push({
        code: "new-material",
        value: "后续立即进入不同功能和声",
      });
    else if (following)
      evidence.push({
        code: "continuous-following-harmony",
        value: "后续和声持续同一功能",
      });

    const score =
      (allVoicesEnd ? 3 : 0) +
      (silenceAfterTarget ? 2 : 0) +
      (longRelease ? 1 : 0) +
      (stableTerminal ? 1 : 0) +
      (terminalFamily === "dominant" ? 3 : 0) +
      // D -> T 与 S -> T 是闭合证据，必须压过其前一属和弦的半终止假设。
      (previousFamily === "dominant" && terminalFamily === "tonic" ? 5 : 0) +
      (previousFamily === "subdominant" && terminalFamily === "tonic" ? 4 : 0) +
      (metric && metric.level >= 2 && metric.confidence === "certain" ? 1 : 0) +
      (following && followingFamily && followingFamily !== terminalFamily ? 1 : 0) -
      (following && followingFamily === terminalFamily ? 2 : 0);
    if (score < 3) continue;
    candidates.push({
      tick,
      score,
      confidence: score >= 4 ? "probable" : "ambiguous",
      evidence,
    });
  }
  return selectBoundaryCandidates(project, candidates);
}

function inferredBoundaryFromCandidate(
  candidate: PhraseBoundaryCandidate,
  inferenceFingerprint: string,
): PhraseBoundary {
  return {
    id: boundaryId(candidate.tick),
    tick: candidate.tick,
    source: "inferred",
    confidence: candidate.confidence,
    inferenceFingerprint,
    stale: false,
  };
}

function candidateHasSufficientSupport(candidate: PhraseBoundaryCandidate) {
  const hasReleaseOrSilence = candidate.evidence.some(
    (evidence) =>
      evidence.code === "all-voices-end" ||
      evidence.code === "silence-after-target" ||
      evidence.code === "long-note-release",
  );
  const hasCadentialPlacement =
    candidate.evidence.some(
      (evidence) => evidence.code === "cadential-connection",
    ) &&
    candidate.evidence.some(
      (evidence) =>
        evidence.code === "metric-support" || evidence.code === "new-material",
    );
  return hasReleaseOrSilence || hasCadentialPlacement;
}

/**
 * 实时分析只读取已保存的结构；候选扫描由和声推导事务显式开启。
 */
export function analyzePhrases(
  project: PhraseAnalysisInput,
  options: PhraseAnalysisOptions = {},
): PhraseAnalysis {
  const shouldGenerateCandidates = options.generateCandidates ?? true;
  const boundaries = normalizeBoundaries(project, options);
  const knownTicks = new Set(boundaries.map((boundary) => boundary.tick));
  const candidates = shouldGenerateCandidates
    ? inferBoundaryCandidates(project).filter(
        (candidate) => !knownTicks.has(candidate.tick),
      )
    : [];
  const inferredBoundaries = options.includeInferredBoundaries
    ? candidates
        .filter(
          (candidate) =>
            candidate.confidence === "probable" &&
            candidateHasSufficientSupport(candidate),
        )
        .map((candidate) =>
          inferredBoundaryFromCandidate(
            candidate,
            phraseInferenceFingerprint(project),
          ),
        )
    : [];
  const mergedBoundaries = inferredBoundaries.length
    ? normalizeBoundaries(
        {
          ...project,
          structure: {
            phraseBoundaries: [...boundaries, ...inferredBoundaries],
          },
        },
        { replaceInferredBoundaries: false },
      )
    : boundaries;
  const segments = buildSegments(mergedBoundaries);
  return {
    boundaries: Object.freeze(mergedBoundaries),
    candidates: Object.freeze(candidates),
    segments: Object.freeze(segments),
  };
}

/**
 * 在和声推导事务中生成新的自动乐句边界。
 * 人工边界始终保留，旧的自动边界会被本次推导结果替换。
 */
export function inferPhrases(project: PhraseAnalysisInput): PhraseAnalysis {
  return analyzePhrases(project, {
    generateCandidates: true,
    includeInferredBoundaries: true,
    replaceInferredBoundaries: true,
  });
}

export function phraseAtTick(
  segments: readonly PhraseSegment[],
  tick: number,
) {
  return segments.find(
    (segment) => segment.fromTick <= tick && tick < segment.toTick,
  );
}
