import type {
  PhraseAnalysis,
  PhraseAnalysisInput,
  PhraseAnalysisOptions,
  PhraseBoundary,
  PhraseBoundaryCandidate,
  PhraseConfidence,
  PhraseEvidence,
  PhraseSegment,
  PhraseStructureTemplate,
  PhraseSupport,
  PhraseTargetRatio,
} from "./types";
import {
  chordIdentityInversion,
  chordStructureQuality,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { buildMetricTimeline, metricPositionAt } from "../../rhythm/metric";
import type { ChordRegion } from "../../project/types";
import { isCurrentPhraseBoundary, phraseInferenceFingerprint } from "./fingerprint";

export const REGULAR_PHRASE_POLICY = Object.freeze({
  maxAutomaticPhrases: 3,
  searchWindowRatio: 0.08,
  minimumAutomaticPhraseMeasures: 1,
  shortPhraseStrongBreakMeasures: 2,
});

const confidenceRank: Record<PhraseConfidence, number> = {
  ambiguous: 0,
  probable: 1,
  certain: 2,
};
const supportRank: Record<PhraseSupport, number> = {
  weak: 0,
  moderate: 1,
  strong: 2,
};
const targetRatioValue: Record<PhraseTargetRatio, number> = {
  half: 0.5,
  third: 1 / 3,
  "two-thirds": 2 / 3,
};

function boundaryId(tick: number) {
  return "phrase-boundary-" + tick;
}

function endpointBoundary(tick: number): PhraseBoundary {
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
    if (!previous || confidenceRank[boundary.confidence] > confidenceRank[previous.confidence])
      byTick.set(tick, { ...boundary, tick });
  }
  return [
    endpointBoundary(0),
    ...[...byTick.values()].sort((left, right) => left.tick - right.tick),
    endpointBoundary(project.lengthTicks),
  ];
}

function boundaryEvidence(
  boundary: PhraseBoundary,
  projectLength: number,
): PhraseEvidence[] {
  if (boundary.tick === 0)
    return [{ code: "project-start", value: "工程起点" }];
  if (boundary.tick === projectLength)
    return [{ code: "project-end", value: "工程终点" }];
  if (boundary.source === "manual")
    return [{ code: "manual-boundary", value: "用户确认的乐句边界", refs: [boundary.id] }];
  return [{
    code: "regular-template-boundary",
    value: "规整结构模板选中的自动乐句边界",
    refs: [boundary.id],
  }];
}

function buildSegments(
  boundaries: readonly PhraseBoundary[],
  projectLength: number,
): PhraseSegment[] {
  return boundaries.slice(0, -1).flatMap((startBoundary, index) => {
    const endBoundary = boundaries[index + 1];
    if (endBoundary.tick <= startBoundary.tick) return [];
    const sources = new Set([startBoundary.source, endBoundary.source]);
    const source: PhraseSegment["source"] =
      sources.size === 1 ? [...sources][0] : "mixed";
    const confidence = confidenceRank[startBoundary.confidence] <=
      confidenceRank[endBoundary.confidence]
      ? startBoundary.confidence
      : endBoundary.confidence;
    return [{
      id: "phrase-" + startBoundary.tick + "-" + endBoundary.tick,
      fromTick: startBoundary.tick,
      toTick: endBoundary.tick,
      startBoundary,
      endBoundary,
      source,
      confidence,
      evidence: [
        ...boundaryEvidence(startBoundary, projectLength),
        ...boundaryEvidence(endBoundary, projectLength),
      ],
    }];
  });
}

function functionalFamily(region: ChordRegion | undefined): FunctionalFamily | undefined {
  if (!region?.semantics) return undefined;
  const confidence = harmonySemanticsConfidence(region.semantics);
  const interpretation = primaryHarmonyInterpretation(region.semantics);
  if (
    confidence === "ambiguous" ||
    confidence === "unknown" ||
    Boolean(interpretation.appliedTarget)
  ) return undefined;
  return effectiveFunctionalDesignation(
    region.semantics,
    chordStructureQuality(region.identity),
  )?.primaryFunction;
}

function regionsOf(project: PhraseAnalysisInput) {
  return [...(project.chordRegions ?? project.chordTrack?.regions ?? [])].sort(
    (left, right) => left.startTick - right.startTick,
  );
}

function effectiveRange(project: PhraseAnalysisInput) {
  const starts: number[] = [];
  const ends: number[] = [];
  project.satbTracks?.forEach((track) => track.notes.forEach((note) => {
    starts.push(note.startTick);
    ends.push(note.startTick + note.durationTicks);
  }));
  regionsOf(project).forEach((region) => {
    starts.push(region.startTick);
    ends.push(region.startTick + region.durationTicks);
  });
  if (starts.length === 0)
    return { startTick: 0, endTick: project.lengthTicks };
  return {
    startTick: Math.max(0, Math.min(...starts)),
    endTick: Math.min(project.lengthTicks, Math.max(...ends)),
  };
}

function measureAt(
  timeline: ReturnType<typeof buildMetricTimeline>,
  tick: number,
) {
  return timeline.measures.find(
    (measure) => measure.startTick <= tick && tick < measure.endTick,
  ) ?? timeline.measures.at(-1);
}

function measureLengthAt(
  timeline: ReturnType<typeof buildMetricTimeline>,
  tick: number,
) {
  const measure = measureAt(timeline, tick);
  return measure ? measure.endTick - measure.startTick : timeline.ppq * 4;
}

function eventTicks(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
) {
  const ticks = new Set<number>();
  timeline.measures.forEach((measure) => {
    ticks.add(measure.startTick);
    ticks.add(measure.endTick);
    measure.beatTicks.forEach((tick) => ticks.add(tick));
  });
  project.satbTracks?.forEach((track) => track.notes.forEach((note) => {
    ticks.add(note.startTick);
    ticks.add(note.startTick + note.durationTicks);
  }));
  regionsOf(project).forEach((region) => {
    ticks.add(region.startTick);
    ticks.add(region.startTick + region.durationTicks);
  });
  return [...ticks].filter(
    (tick) => Number.isInteger(tick) && tick > 0 && tick < project.lengthTicks,
  );
}

function voicesEndingAt(project: PhraseAnalysisInput, tick: number) {
  return project.satbTracks?.filter((track) => track.notes.some(
    (note) => note.startTick + note.durationTicks === tick,
  )).length ?? 0;
}

function voicesStartingAt(project: PhraseAnalysisInput, tick: number) {
  return project.satbTracks?.filter((track) => track.notes.some(
    (note) => note.startTick === tick,
  )).length ?? 0;
}

function hasSoundAcross(project: PhraseAnalysisInput, tick: number) {
  return project.satbTracks?.some((track) => track.notes.some(
    (note) => note.startTick < tick && note.startTick + note.durationTicks > tick,
  )) ?? false;
}

function nextAttackAfter(project: PhraseAnalysisInput, tick: number) {
  const attacks = project.satbTracks?.flatMap((track) => track.notes
    .filter((note) => note.startTick >= tick)
    .map((note) => note.startTick)) ?? [];
  return attacks.length ? Math.min(...attacks) : undefined;
}

function longestEndingDuration(project: PhraseAnalysisInput, tick: number) {
  return Math.max(0, ...(project.satbTracks?.flatMap((track) => track.notes
    .filter((note) => note.startTick + note.durationTicks === tick)
    .map((note) => note.durationTicks)) ?? []));
}

function terminalRegionAt(regions: readonly ChordRegion[], tick: number) {
  return regions.find((region) => region.startTick + region.durationTicks === tick);
}

function previousRegion(regions: readonly ChordRegion[], region: ChordRegion | undefined) {
  return region
    ? regions.find((candidate) => candidate.startTick + candidate.durationTicks === region.startTick)
    : undefined;
}

function followingRegion(regions: readonly ChordRegion[], tick: number) {
  return regions.find((region) => region.startTick === tick);
}

function boundaryFacts(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  regions: readonly ChordRegion[],
  tick: number,
  atTemplateTarget: boolean,
) {
  const evidence: PhraseEvidence[] = [];
  const trackCount = project.satbTracks?.length ?? 0;
  const endingVoices = voicesEndingAt(project, tick);
  const startingVoices = voicesStartingAt(project, tick);
  const allVoicesEnd = trackCount > 0 && endingVoices === trackCount;
  const soundAcross = hasSoundAcross(project, tick);
  const measure = measureAt(timeline, tick);
  const beatLength = measure?.beatLength ?? timeline.ppq;
  const nextAttack = nextAttackAfter(project, tick);
  const actualSilence = allVoicesEnd && !soundAcross &&
    (nextAttack === undefined || nextAttack - tick >= beatLength);
  const longRelease = longestEndingDuration(project, tick) >= beatLength * 2;

  if (allVoicesEnd)
    evidence.push({ code: "all-voices-end", value: "全部 SATB 声部在此处释放" });
  if (actualSilence)
    evidence.push({ code: "silence-after-target", value: "释放后至少一拍实际静音" });
  if (longRelease)
    evidence.push({ code: "long-note-release", value: "长时值音符在此处释放" });

  const metric = metricPositionAt(timeline, tick);
  if (metric && metric.level >= 2 && metric.confidence === "certain")
    evidence.push({
      code: "metric-support",
      value: metric.role === "downbeat" ? "位于小节线" : "位于次强拍",
    });

  const reattack = allVoicesEnd && startingVoices === trackCount;
  const terminal = terminalRegionAt(regions, tick) ??
    (atTemplateTarget && reattack
      ? regions.find((region) => region.startTick < tick && tick < region.startTick + region.durationTicks)
      : undefined);
  const previous = previousRegion(regions, terminal);
  const following = followingRegion(regions, tick);
  const terminalFamily = functionalFamily(terminal);
  const previousFamily = functionalFamily(previous);
  const followingFamily = functionalFamily(following);
  const terminalDegree = terminal?.semantics && primaryHarmonyInterpretation(terminal.semantics).degree;
  const endsOnDominant = terminalFamily === "dominant" && terminalDegree === 5;
  const endsOnSubdominant = terminalFamily === "subdominant" && terminalDegree === 4 &&
    previousFamily === "tonic" && terminal && chordIdentityInversion(terminal.identity) === 0 &&
    tick - terminal.startTick >= measureLengthAt(timeline, tick - 1);
  if (terminalFamily)
    evidence.push({ code: "stable-harmony", value: "末端具有确定功能和声" });
  if (
    endsOnDominant || endsOnSubdominant ||
    (terminalFamily === "tonic" && terminalDegree === 1 &&
      (previousFamily === "dominant" || previousFamily === "subdominant"))
  ) evidence.push({ code: "cadential-connection", value: "末端具有和声收束" });
  if (followingFamily && terminalFamily && followingFamily !== terminalFamily)
    evidence.push({ code: "new-material", value: "边界后进入不同功能材料" });
  else if (following)
    evidence.push({ code: "continuous-following-harmony", value: "边界后和声材料连续" });

  const strongBreak = actualSilence;
  const moderate = new Set<string>();
  if (metric && metric.level >= 2 && metric.confidence === "certain")
    moderate.add("metric");
  if (evidence.some((item) => item.code === "cadential-connection"))
    moderate.add("harmony");
  if (longRelease) moderate.add("duration");
  if (evidence.some((item) => item.code === "new-material"))
    moderate.add("material");
  if (endingVoices >= 2 && startingVoices < 2 && !soundAcross)
    moderate.add("release");
  const hasStructuralCategory = ["duration", "material", "release"]
    .some((category) => moderate.has(category));
  const sameMaterial = evidence.some(
    (item) => item.code === "continuous-following-harmony",
  );
  // A chorale can breathe at a barline with all four parts rearticulating.
  // At the metrical midpoint, a lengthened closing harmony gives that
  // articulation structural weight even if the next phrase starts at once.
  const articulatedCadence = reattack && atTemplateTarget && metric?.role === "downbeat" &&
    longRelease && evidence.some((item) => item.code === "cadential-connection");
  const rootPositionArrival = terminal && chordIdentityInversion(terminal.identity) === 0;
  const support: PhraseSupport = strongBreak
    ? "strong"
    : (articulatedCadence && rootPositionArrival) ||
      (moderate.size >= 2 && hasStructuralCategory && !sameMaterial && !reattack)
      ? "moderate"
      : "weak";
  return { evidence, support, articulatedDominant: articulatedCadence && endsOnDominant && previousFamily === "dominant" };
}

function candidateAtRatio(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  targetRatio: PhraseTargetRatio,
): PhraseBoundaryCandidate | undefined {
  const range = effectiveRange(project);
  const length = range.endTick - range.startTick;
  if (length <= 0) return undefined;
  const targetTick = range.startTick + length * targetRatioValue[targetRatio];
  const window = Math.max(
    timeline.ppq / 4,
    Math.min(measureLengthAt(timeline, targetTick), length * REGULAR_PHRASE_POLICY.searchWindowRatio),
  );
  const regions = regionsOf(project);
  const nearby = eventTicks(project, timeline)
    .filter((tick) =>
      tick >= targetTick - window && tick <= targetTick + window &&
      tick > range.startTick && tick < range.endTick)
    .map((tick) => {
      const facts = boundaryFacts(project, timeline, regions, tick, targetRatio === "half" && tick === targetTick);
      const metric = metricPositionAt(timeline, tick);
      const snapPriority = metric?.role === "downbeat"
        ? 0
        : metric && metric.level >= 2
          ? 1
          : voicesEndingAt(project, tick) >= 2
            ? 2
            : terminalRegionAt(regions, tick)
              ? 3
              : 4;
      return {
        tick,
        facts,
        distance: Math.abs(tick - targetTick),
        snapPriority,
      };
    });
  // An inverted dominant can locate an already supported division at the
  // exact barline, but by itself cannot justify cutting an ongoing V2–I6.
  const hasNearbyDivision = nearby.some(item => item.facts.support !== "weak" && item.distance > 0 &&
    item.distance <= measureLengthAt(timeline, targetTick) / 2);
  const candidates = nearby
    .map(item => item.facts.articulatedDominant && hasNearbyDivision && item.facts.support === "weak"
      ? { ...item, facts: { ...item.facts, support: "moderate" as const } }
      : item)
    .filter((item) => item.facts.support !== "weak")
    .sort((left, right) =>
      supportRank[right.facts.support] - supportRank[left.facts.support] ||
      left.snapPriority - right.snapPriority ||
      left.distance - right.distance || left.tick - right.tick);
  const best = candidates[0];
  if (!best) return undefined;
  const ratioLabel = targetRatio === "half"
    ? "1/2"
    : targetRatio === "third" ? "1/3" : "2/3";
  return {
    tick: best.tick,
    targetRatio,
    distanceToTarget: best.distance,
    support: best.facts.support,
    score: best.facts.support === "strong" ? 2 : 1,
    confidence: "probable",
    evidence: [
      { code: "regular-template-target", value: "接近有效时长的 " + ratioLabel + " 位置" },
      ...best.facts.evidence,
    ],
  };
}

function boundariesMeetLength(
  timeline: ReturnType<typeof buildMetricTimeline>,
  range: { startTick: number; endTick: number },
  candidates: readonly PhraseBoundaryCandidate[],
) {
  const points = [range.startTick, ...candidates.map((item) => item.tick), range.endTick];
  return points.slice(0, -1).every((point, index) => {
    const length = points[index + 1] - point;
    const measureLength = measureLengthAt(timeline, point);
    if (length < measureLength * REGULAR_PHRASE_POLICY.minimumAutomaticPhraseMeasures)
      return false;
    if (length >= measureLength * REGULAR_PHRASE_POLICY.shortPhraseStrongBreakMeasures)
      return true;
    const adjacentBoundary = candidates[index] ?? candidates[index - 1];
    return adjacentBoundary?.support === "strong";
  });
}

function selectTemplate(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  candidates: readonly PhraseBoundaryCandidate[],
): PhraseStructureTemplate {
  const range = effectiveRange(project);
  const byRatio = new Map(candidates.map((candidate) => [candidate.targetRatio, candidate]));
  const half = byRatio.get("half");
  const firstThird = byRatio.get("third");
  const secondThird = byRatio.get("two-thirds");
  const dupleValid = Boolean(half && boundariesMeetLength(timeline, range, [half]));
  const tripleValid = Boolean(
    firstThird && secondThird &&
    boundariesMeetLength(timeline, range, [firstThird, secondThird]) &&
    (firstThird.support === "strong" || secondThird.support === "strong"),
  );
  if (tripleValid && firstThird && secondThird) {
    const tripleStrength = supportRank[firstThird.support] + supportRank[secondThird.support];
    const dupleStrength = half ? supportRank[half.support] : -1;
    if (!dupleValid || tripleStrength >= dupleStrength + 2)
      return { kind: "triple", boundaries: [firstThird, secondThird] };
  }
  if (dupleValid && half) return { kind: "duple", boundaries: [half] };
  return { kind: "single", boundaries: [] };
}

function inferRegularStructure(project: PhraseAnalysisInput) {
  if (!project.ppq || !project.meterEvents?.length)
    return {
      candidates: [] as PhraseBoundaryCandidate[],
      template: { kind: "single", boundaries: [] } as PhraseStructureTemplate,
    };
  const timeline = buildMetricTimeline({
    ppq: project.ppq,
    meterEvents: project.meterEvents,
    lengthTicks: project.lengthTicks,
  });
  const candidates = (["half", "third", "two-thirds"] as const)
    .map((ratio) => candidateAtRatio(project, timeline, ratio))
    .filter((candidate): candidate is PhraseBoundaryCandidate => Boolean(candidate));
  return { candidates, template: selectTemplate(project, timeline, candidates) };
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

export function analyzePhrases(
  project: PhraseAnalysisInput,
  options: PhraseAnalysisOptions = {},
): PhraseAnalysis {
  const boundaries = normalizeBoundaries(project, options);
  const generated = (options.generateCandidates ?? true)
    ? inferRegularStructure(project)
    : {
        candidates: [] as PhraseBoundaryCandidate[],
        template: { kind: "single", boundaries: [] } as PhraseStructureTemplate,
      };
  const knownTicks = new Set(boundaries.map((boundary) => boundary.tick));
  const candidates = generated.candidates.filter((candidate) => !knownTicks.has(candidate.tick));
  const selected = options.includeInferredBoundaries
    ? generated.template.boundaries.filter((candidate) => !knownTicks.has(candidate.tick))
    : [];
  const inferred = selected.map((candidate) =>
    inferredBoundaryFromCandidate(candidate, phraseInferenceFingerprint(project)));
  const merged = inferred.length
    ? normalizeBoundaries({
        ...project,
        structure: { phraseBoundaries: [...boundaries, ...inferred] },
      }, { replaceInferredBoundaries: false })
    : boundaries;
  return {
    boundaries: Object.freeze(merged),
    candidates: Object.freeze(candidates),
    segments: Object.freeze(buildSegments(merged, project.lengthTicks)),
    template: generated.template,
  };
}

export function inferPhrases(project: PhraseAnalysisInput): PhraseAnalysis {
  return analyzePhrases(project, {
    generateCandidates: true,
    includeInferredBoundaries: true,
    replaceInferredBoundaries: true,
  });
}

export function phraseAtTick(segments: readonly PhraseSegment[], tick: number) {
  return segments.find((segment) => segment.fromTick <= tick && tick < segment.toTick);
}
