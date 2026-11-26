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
  chordIdentityEquals,
  chordIdentityInversion,
  chordStructureQuality,
  harmonySemanticsConfidence,
  isSeventhStructure,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { buildMetricTimeline, metricPositionAt } from "../../rhythm/metric";
import {
  isWrittenStep,
  pitchClassEquals,
  writtenInterval,
  spelledPitchEquals,
  type SpelledPitch,
} from "../../pitch";
import { eventAtTick, orderedEvents } from "../../time";
import type { ChordRegion } from "../../project/types";
import { hasMinimumEventPhraseLength, measurePosition, phraseTemplate, selectEventDivisions, shortOpeningMeasure } from "./segmentation";
import { cadentialRestart, releasesRevoicedSubmediant } from "./cadentialRestart";
import { isCurrentPhraseBoundary, phraseInferenceFingerprint } from "./fingerprint";
import { melodicFigureMatcher, reprisedOpeningAfterDominant } from "./reprisedOpening";
import {
  confirmedFullCadences, followingRegion, measureAt, previousRegion, sameKey,
  terminalRegionAt, voicesEndingAt, voicesStartingAt,
} from "./timelineEvidence";

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
type RegularTargetRatio = Exclude<PhraseTargetRatio, "event">;
const targetRatioValue: Record<RegularTargetRatio, number> = {
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
      (!options.replaceInferredBoundaries || boundary.source === "manual" || boundary.locked) &&
      isCurrentPhraseBoundary(project, boundary),
  );
  const byTick = new Map<number, PhraseBoundary>();
  for (const boundary of supplied) {
    if (!Number.isInteger(boundary.tick)) continue;
    const tick = Math.max(0, Math.min(project.lengthTicks, boundary.tick));
    if (tick === 0 || tick === project.lengthTicks) continue;
    const previous = byTick.get(tick);
    const fixed = (item: PhraseBoundary) => Number(item.source === "manual") * 2 + Number(Boolean(item.locked));
    if (!previous || fixed(boundary) > fixed(previous) ||
        (fixed(boundary) === fixed(previous) && confidenceRank[boundary.confidence] > confidenceRank[previous.confidence]))
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
    value: "自动推导的乐句边界",
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

function writtenBassPath(
  project: PhraseAnalysisInput,
  source: ChordRegion,
  middle: ChordRegion,
  target: ChordRegion,
  holdOuterChords: boolean,
) {
  const bass = project.satbTracks?.find(track => track.id === "bass");
  // A chord's bass spelling has no register and cannot rule out octave leaps.
  if (!bass) return undefined;
  const notes = [...bass.notes].sort((left, right) => left.startTick - right.startTick);
  const pitchAcross = (fromTick: number, toTick: number) => {
    let coveredTo = fromTick;
    let pitch: SpelledPitch | undefined;
    for (const note of notes) {
      const endTick = note.startTick + note.durationTicks;
      if (endTick <= coveredTo) continue;
      if (note.startTick > coveredTo || !note.pitch ||
          (pitch && !spelledPitchEquals(pitch, note.pitch))) {
        return undefined;
      }
      pitch = note.pitch;
      coveredTo = endTick;
      if (coveredTo >= toTick) return pitch;
    }
    return undefined;
  };
  // A passing bass needs the two steps at the edges. A pedal must
  // stay on the same written pitch through all three harmonies.
  const before = pitchAcross(holdOuterChords ? source.startTick : middle.startTick - 1, middle.startTick);
  const during = pitchAcross(middle.startTick, target.startTick);
  const after = pitchAcross(target.startTick, target.startTick + (holdOuterChords ? target.durationTicks : 1));
  if (!before || !during || !after ||
      !pitchClassEquals(before, source.identity.bass) ||
      !pitchClassEquals(during, middle.identity.bass) ||
      !pitchClassEquals(after, target.identity.bass)) return undefined;
  return { before, during, after };
}

function isProlongingSixFour(
  project: PhraseAnalysisInput,
  source: ChordRegion | undefined,
  middle: ChordRegion | undefined,
  target: ChordRegion | undefined,
) {
  const role = middle?.semantics?.cadenceRole;
  if ((role !== "pedal64" && role !== "passing64") ||
      !source?.semantics || !middle?.semantics || !target?.semantics ||
      chordIdentityInversion(middle.identity) !== 2 ||
      source.startTick + source.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== target.startTick) return false;

  const family = functionalFamily(source);
  if (!family || family !== functionalFamily(target) || !functionalFamily(middle)) return false;
  const keyEvents = orderedEvents(project.keyEvents ?? []);
  const printedKey = keyEvents.length ? eventAtTick(keyEvents, source.startTick) : undefined;
  if (printedKey && keyEvents.some(event => event.tick > source.startTick &&
      event.tick <= target.startTick && !sameKey(printedKey, event))) return false;

  const keys = [source.semantics, middle.semantics, target.semantics].map(semantics =>
    primaryHarmonyInterpretation(semantics).localKey ?? printedKey);
  const key = keys.find(candidate => candidate !== undefined);
  if (!key || keys.some(other => !other || !sameKey(key, other))) return false;

  const sourceInversion = chordIdentityInversion(source.identity);
  const targetInversion = chordIdentityInversion(target.identity);
  const sameHarmony = role === "pedal64"
    ? sourceInversion === 0 && chordIdentityEquals(source.identity, target.identity)
    : ((sourceInversion === 0 && targetInversion === 1) ||
       (sourceInversion === 1 && targetInversion === 0)) &&
      chordIdentityEquals(source.identity, { ...target.identity, bass: source.identity.bass });
  if (!sameHarmony) return false;

  const bass = writtenBassPath(project, source, middle, target, role === "pedal64");
  if (!bass) return false;
  const { before, during, after } = bass;
  if (role === "pedal64") {
    return spelledPitchEquals(before, during) && spelledPitchEquals(during, after);
  }

  const into = writtenInterval(before, during);
  const out = writtenInterval(during, after);
  return isWrittenStep(into) && isWrittenStep(out) && into.diatonicSteps === out.diatonicSteps;
}

function hasMidpointDominantHold(
  project: PhraseAnalysisInput,
  regions: readonly ChordRegion[],
  terminal: ChordRegion,
  previous: ChordRegion | undefined,
  following: ChordRegion,
  beatLength: number,
  longRelease: boolean,
) {
  const tick = following.startTick;
  const followingFamily = functionalFamily(following);
  if (terminal.startTick + terminal.durationTicks !== tick ||
      !followingFamily || followingFamily === "dominant") return false;

  const keyEvents = orderedEvents(project.keyEvents ?? []);
  const localKeyOf = (region: ChordRegion) =>
    (region.semantics && primaryHarmonyInterpretation(region.semantics).localKey) ??
    (keyEvents.length ? eventAtTick(keyEvents, region.startTick) : undefined);
  const key = localKeyOf(terminal);
  const followingKey = localKeyOf(following);
  if (!key || !followingKey || !sameKey(key, followingKey)) return false;

  const inversion = chordIdentityInversion(terminal.identity);
  if (inversion !== 0 && inversion !== 3) return false;
  if (inversion === 0 && terminal.durationTicks >= beatLength * 2) return true;
  if (inversion === 3) {
    const followingInversion = chordIdentityInversion(following.identity);
    if (!previous || followingFamily !== "tonic" || !following.semantics ||
        primaryHarmonyInterpretation(following.semantics).degree !== 1 || followingInversion > 1) return false;
    const preparation = previousRegion(regions, previous);
    if (isProlongingSixFour(project, previousRegion(regions, preparation), preparation, previous)) return false;

    const bass = writtenBassPath(project, previous, terminal, following, false);
    if (!bass) return false;
    const into = writtenInterval(bass.before, bass.during);
    const out = writtenInterval(bass.during, bass.after);
    if (!isWrittenStep(into) || into.diatonicSteps !== -1 ||
        (followingInversion === 1 && (!isWrittenStep(out) || out.diatonicSteps !== -1))) return false;
  }

  let start = terminal;
  for (let preceding = previous; preceding; preceding = previousRegion(regions, start)) {
    if (preceding.startTick >= start.startTick || !preceding.semantics ||
        functionalFamily(preceding) !== "dominant" ||
        primaryHarmonyInterpretation(preceding.semantics).degree !== 5 ||
        chordIdentityInversion(preceding.identity) !== 0 ||
        !pitchClassEquals(preceding.identity.root, terminal.identity.root)) break;
    const previousKey = localKeyOf(preceding);
    if (!previousKey || !sameKey(key, previousKey)) break;
    start = preceding;
    if (tick - start.startTick >= beatLength * 2) return true;
  }
  return inversion === 3 && start !== terminal && longRelease;
}

interface BoundaryRhythmFrame {
  readonly startingVoices: number;
  readonly endingVoices: number;
  readonly soundAcross: boolean;
  readonly nextAttack: number | undefined;
  readonly longestRelease: number;
}

function boundaryRhythmFacts(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  tick: number,
  evidence: PhraseEvidence[],
  indexed?: BoundaryRhythmFrame,
) {
  const trackCount = project.satbTracks?.length ?? 0;
  const endingVoices = indexed?.endingVoices ?? voicesEndingAt(project, tick);
  const startingVoices = indexed?.startingVoices ?? voicesStartingAt(project, tick);
  const allVoicesEnd = trackCount > 0 && endingVoices === trackCount;
  const soundAcross = indexed?.soundAcross ?? hasSoundAcross(project, tick);
  const measure = measureAt(timeline, tick);
  const beatLength = measure?.beatLength ?? timeline.ppq;
  const nextAttack = indexed ? indexed.nextAttack : nextAttackAfter(project, tick);
  const actualSilence = allVoicesEnd && !soundAcross &&
    (nextAttack === undefined || nextAttack - tick >= beatLength);
  const longRelease = (indexed?.longestRelease ?? longestEndingDuration(project, tick)) >= beatLength * 2;

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
  return {
    endingVoices, startingVoices, soundAcross, actualSilence, longRelease, reattack,
    beatLength, metric,
  };
}

function boundaryHarmonyFacts(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  regions: readonly ChordRegion[],
  tick: number,
  allowSustainedTerminal: boolean,
  evidence: PhraseEvidence[],
) {
  const terminal = terminalRegionAt(regions, tick) ??
    (allowSustainedTerminal
      ? regions.find((region) => region.startTick < tick && tick < region.startTick + region.durationTicks)
      : undefined);
  const previous = previousRegion(regions, terminal);
  const following = followingRegion(regions, tick);
  const afterFollowing = following && followingRegion(regions, following.startTick + following.durationTicks);
  const leavesSixFour = isProlongingSixFour(project, previous, terminal, following);
  const entersSixFour = isProlongingSixFour(project, terminal, following, afterFollowing);
  const insideProlongation = leavesSixFour || entersSixFour;

  const terminalFamily = functionalFamily(terminal);
  const previousFamily = functionalFamily(previous);
  const followingFamily = functionalFamily(following);
  const terminalDegree = terminal?.semantics && primaryHarmonyInterpretation(terminal.semantics).degree;
  const endsOnDominant = !insideProlongation && terminalFamily === "dominant" && terminalDegree === 5;
  const endsOnSubdominant = terminalFamily === "subdominant" && terminalDegree === 4 &&
    previousFamily === "tonic" && terminal && chordIdentityInversion(terminal.identity) === 0 &&
    tick - terminal.startTick >= measureLengthAt(timeline, tick - 1);
  if (terminalFamily && !leavesSixFour)
    evidence.push({ code: "stable-harmony", value: "末端具有确定功能和声" });
  if (!leavesSixFour && (
    endsOnDominant || endsOnSubdominant ||
    (terminalFamily === "tonic" && terminalDegree === 1 &&
      (previousFamily === "dominant" || previousFamily === "subdominant"))
  )) evidence.push({ code: "cadential-connection", value: "末端具有和声收束" });

  // The change into or out of a prolonging six-four contributes no material
  // vote. Duration, release, and metre still contribute on their own.
  if (!insideProlongation && following) {
    if (followingFamily && terminalFamily && followingFamily !== terminalFamily)
      evidence.push({ code: "new-material", value: "边界后进入不同功能材料" });
    else
      evidence.push({ code: "continuous-following-harmony", value: "边界后和声材料连续" });
  }

  return { terminal, previous, following, previousFamily, endsOnDominant, insideProlongation };
}

function boundaryFacts(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  regions: readonly ChordRegion[],
  tick: number,
  atTemplateTarget: boolean,
  hasRoomForTwoPhrases: boolean,
) {
  const evidence: PhraseEvidence[] = [];
  const {
    endingVoices, startingVoices, soundAcross, actualSilence, longRelease, reattack,
    beatLength, metric,
  } = boundaryRhythmFacts(project, timeline, tick, evidence);
  const { terminal, previous, following, previousFamily, endsOnDominant } = boundaryHarmonyFacts(
    project, timeline, regions, tick, atTemplateTarget && reattack, evidence,
  );

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
  const prolongsDominant = endsOnDominant && terminal && following?.semantics &&
    functionalFamily(following) === "dominant" && primaryHarmonyInterpretation(following.semantics).degree === 5 &&
    pitchClassEquals(terminal.identity.root, following.identity.root);
  const articulatedCadence = !prolongsDominant && reattack && atTemplateTarget && metric?.role === "downbeat" &&
    longRelease && evidence.some((item) => item.code === "cadential-connection");
  const rootPositionArrival = terminal && chordIdentityInversion(terminal.identity) === 0;
  const midpointDominantHold = atTemplateTarget && hasRoomForTwoPhrases &&
    metric?.role === "downbeat" && endsOnDominant && terminal && following &&
    (reattack || (!rootPositionArrival && longRelease)) &&
    hasMidpointDominantHold(project, regions, terminal, previous, following, beatLength, longRelease);
  const support: PhraseSupport = strongBreak
    ? "strong"
    : midpointDominantHold || (articulatedCadence && rootPositionArrival) ||
      (moderate.size >= 2 && hasStructuralCategory && !sameMaterial && !reattack)
      ? "moderate"
      : "weak";
  return { evidence, support, articulatedDominant: articulatedCadence && endsOnDominant && previousFamily === "dominant" };
}

function nearbyRatioCandidates(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  regions: readonly ChordRegion[],
  range: ReturnType<typeof effectiveRange>,
  search: { targetRatio: RegularTargetRatio; targetTick: number; window: number },
) {
  const { targetRatio, targetTick, window } = search;
  const hasRoomForTwoPhrases = targetRatio === "half" && [
    [range.startTick, targetTick], [targetTick, range.endTick],
  ].every(([start, end]) => timeline.measures.filter(measure =>
    measure.startTick >= start && measure.endTick <= end &&
    measure.endTick - measure.startTick === measure.numerator * measure.beatLength).length >= 3);
  return eventTicks(project, timeline)
    .filter((tick) =>
      tick >= targetTick - window && tick <= targetTick + window &&
      tick > range.startTick && tick < range.endTick)
    .map((tick) => {
      const facts = boundaryFacts(
        project, timeline, regions, tick, targetRatio === "half" && tick === targetTick, hasRoomForTwoPhrases,
      );
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
}

function bestSupportedCandidate(
  nearby: ReturnType<typeof nearbyRatioCandidates>,
  timeline: ReturnType<typeof buildMetricTimeline>,
  targetTick: number,
): ReturnType<typeof nearbyRatioCandidates>[number] | undefined {
  // An inverted dominant can also locate an independently supported division.
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
  return candidates[0];
}

function candidateAtRatio(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  targetRatio: RegularTargetRatio,
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
  const nearby = nearbyRatioCandidates(project, timeline, regions, range, { targetRatio, targetTick, window });
  let best = bestSupportedCandidate(nearby, timeline, targetTick);
  if (!best && targetRatio === "half" && !project.structure?.phraseBoundaries?.some(boundary =>
    boundary.source === "manual" || boundary.locked)) {
    for (const item of nearby.sort((left, right) => left.distance - right.distance || left.tick - right.tick)) {
      const reprise = reprisedOpeningAfterDominant({ project, timeline, regions, scoreStart: range.startTick }, item.tick);
      if (!reprise) continue;
      best = { ...item, facts: { ...item.facts, support: "moderate", evidence: [...item.facts.evidence, reprise] } };
      break;
    }
  }
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

const eventWeights = {
  pause: 6,
  longRelease: 3,
  wholeBarRelease: 1,
  dominant: 2,
  cadence: 4,
  reprise: 7,
  tonicRestart: 1,
  fourBarGrid: 1,
  pickup: 1,
  sustainedVoice: -2,
  continuousHarmony: -3,
  unstable: -5,
  divisionCost: 4,
  establishedMinimum: 4,
} as const;

function alignedPickupTicks(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  range: ReturnType<typeof effectiveRange>,
) {
  const firstAttack = nextAttackAfter(project, range.startTick);
  if (firstAttack === undefined) return new Set<number>();
  const first = measureAt(timeline, firstAttack);
  if (!first) return new Set<number>();
  const position = metricPositionAt(timeline, firstAttack);
  const shortOpening = first === shortOpeningMeasure(timeline);
  if (!shortOpening && (!position || position.role === "downbeat")) return new Set<number>();
  const pickupBeats = (first.endTick - firstAttack) / first.beatLength;
  return new Set(timeline.measures.flatMap(measure => {
    const tick = measure.startTick + (measure.numerator - pickupBeats) * measure.beatLength;
    return Number.isInteger(tick) && tick > measure.startTick && tick < measure.endTick &&
      tick > firstAttack ? [tick] : [];
  }));
}

function phraseRhythmEvents(project: PhraseAnalysisInput) {
  const notes = project.satbTracks?.flatMap(track => track.notes) ?? [];
  const averageDuration = notes.length
    ? notes.reduce((total, note) => total + note.durationTicks, 0) / notes.length
    : 0;
  const releases = new Map<number, number[]>();
  const attacks = new Map<number, number[]>();
  const add = (events: Map<number, number[]>, tick: number, duration: number) => {
    const durations = events.get(tick) ?? [];
    durations.push(duration);
    events.set(tick, durations);
  };
  for (const note of notes) {
    add(releases, note.startTick + note.durationTicks, note.durationTicks);
    add(attacks, note.startTick, note.durationTicks);
  }
  return { averageDuration, releases, attacks };
}

function harmonyEndingScore(
  terminal: ChordRegion | undefined,
  previous: ChordRegion | undefined,
  endsOnDominant: boolean,
  hasRelease: boolean,
) {
  if (!terminal?.semantics) return { closure: 0, unstable: false };
  const reading = primaryHarmonyInterpretation(terminal.semantics);
  const inversion = chordIdentityInversion(terminal.identity);
  const previousReading = previous?.semantics && primaryHarmonyInterpretation(previous.semantics);
  const coherent = !reading.localKey || !previousReading?.localKey ||
    sameKey(reading.localKey, previousReading.localKey);
  const fromDominant = coherent && previousReading?.degree === 5 && functionalFamily(previous) === "dominant" &&
    previous && chordIdentityInversion(previous.identity) === 0;
  const cadentialSixFour = coherent && previous?.semantics?.cadenceRole === "cadential64";
  const authenticOrDeceptive = fromDominant && hasRelease &&
    ((reading.degree === 1 && inversion === 0 && functionalFamily(terminal) === "tonic") ||
      (reading.degree === 6 && inversion === 0 && functionalFamily(terminal) !== undefined));
  const unstable = Boolean(reading.appliedTarget) || reading.degree === 7 ||
    (inversion === 2 && terminal.semantics.cadenceRole !== "cadential64") ||
    (reading.degree === 5 && inversion > 0 && isSeventhStructure(terminal.identity.structure));
  const closure = authenticOrDeceptive || (endsOnDominant && inversion === 0 && cadentialSixFour)
    ? eventWeights.cadence
    : endsOnDominant && inversion === 0 ? eventWeights.dominant : 0;
  return { closure, unstable };
}

function eventCandidates(
  project: PhraseAnalysisInput,
  timeline: ReturnType<typeof buildMetricTimeline>,
  regions: readonly ChordRegion[],
  range: ReturnType<typeof effectiveRange>,
  established: readonly PhraseBoundaryCandidate[],
) {
  const pickup = alignedPickupTicks(project, timeline, range);
  const { averageDuration, releases, attacks } = phraseRhythmEvents(project);
  const establishedByTick = new Map(established.map(candidate => [candidate.tick, candidate]));
  const ticks = new Set([
    ...timeline.measures.map(measure => measure.startTick),
    ...pickup,
    ...establishedByTick.keys(),
  ]);
  const barlines = new Set(timeline.measures.map(measure => measure.startTick));
  const rhythms = new Map<number, BoundaryRhythmFrame>();
  const previousRelease = new Map<number, number>();
  const nextAttack = new Map<number, number>();
  const eventTimes = [...new Set([...ticks, ...attacks.keys(), ...releases.keys()])].sort((a, b) => a - b);
  let upcoming: number | undefined;
  for (let index = eventTimes.length - 1; index >= 0; index--) {
    const tick = eventTimes[index];
    if (attacks.has(tick)) upcoming = tick;
    if (upcoming !== undefined) nextAttack.set(tick, upcoming);
  }
  let lastRelease: number | undefined;
  let sounding = 0;
  for (const tick of eventTimes) {
    const attacked = attacks.get(tick) ?? [];
    const released = releases.get(tick) ?? [];
    sounding -= released.length;
    rhythms.set(tick, { startingVoices: attacked.length, endingVoices: released.length,
      soundAcross: sounding > 0, nextAttack: nextAttack.get(tick), longestRelease: Math.max(0, ...released) });
    sounding += attacked.length;
    // Also enumerate a breath's restart and a coordinated release off the barline.
    if (released.length >= 2 || (attacked.length >= 2 && lastRelease !== undefined)) ticks.add(tick);
    if (lastRelease !== undefined) previousRelease.set(tick, lastRelease);
    if (released.length) lastRelease = tick;
  }
  const openingTick = nextAttackAfter(project, range.startTick) ?? range.startTick;
  const opening = measureAt(timeline, openingTick);
  const openingPosition = measurePosition(timeline, openingTick);
  const sopranoFigure = melodicFigureMatcher(project.satbTracks?.find(track => track.id === "soprano"));
  const bassFigure = melodicFigureMatcher(project.satbTracks?.find(track => track.id === "bass"));
  const confirmed = confirmedFullCadences(project);
  const hasFixedBoundary = project.structure?.phraseBoundaries?.some(boundary =>
    boundary.source === "manual" || boundary.locked);
  return [...ticks].sort((left, right) => left - right).flatMap((tick): PhraseBoundaryCandidate[] => {
    if (tick <= range.startTick || tick >= range.endTick) return [];
    const evidence: PhraseEvidence[] = [];
    const { startingVoices, endingVoices, soundAcross, actualSilence, beatLength, metric } =
      boundaryRhythmFacts(project, timeline, tick, evidence, rhythms.get(tick));
    const onPickup = pickup.has(tick) && startingVoices > 0 && !soundAcross;
    const restart = nextAttack.get(tick);
    const release = !soundAcross && endingVoices === 0 ? previousRelease.get(tick) : undefined;
    const closingTick = release !== undefined && tick - release <= beatLength * 2 ? release : tick;
    const establishedRelease = establishedByTick.get(closingTick);
    // In a short period the audible release can be an established short
    // sentence. Do not replace it with the later start merely to round up.
    if (closingTick < tick && establishedRelease?.support === "strong" &&
        !hasMinimumEventPhraseLength(timeline, range.startTick, closingTick)) return [];
    const releaseFacts = closingTick === tick ? undefined :
      boundaryRhythmFacts(project, timeline, closingTick, evidence, rhythms.get(closingTick));
    const releaseNotes = releases.get(closingTick) ?? [];
    const gap = restart === undefined ? 0 : restart - closingTick;
    const pause = Boolean(actualSilence || releaseFacts?.actualSilence ||
      (releaseNotes.length >= 2 && !rhythms.get(closingTick)?.soundAcross && gap >= beatLength));
    const releasesInVoices = releaseNotes;
    const minimumVoices = Math.max(2, Math.min(3, releaseFacts?.endingVoices ?? endingVoices));
    const sustainedRelease = (duration: number) =>
      releasesInVoices.filter(release => release >= duration).length >= minimumVoices;
    const longRelease = sustainedRelease(Math.max(beatLength * 2, averageDuration * 1.4));
    const wholeBarRelease = sustainedRelease(measureLengthAt(timeline, closingTick - 1));
    const { terminal, previous, endsOnDominant, insideProlongation } = boundaryHarmonyFacts(
      project, timeline, regions, closingTick, false, evidence,
    );
    const following = followingRegion(regions, tick);
    const beforePrevious = previousRegion(regions, previous);
    const followsProlongation = isProlongingSixFour(project, beforePrevious, previous, terminal) ||
      isProlongingSixFour(project, previousRegion(regions, beforePrevious), beforePrevious, previous);
    const coordinated = endingVoices >= 2 && startingVoices >= 2 &&
      releasesInVoices.filter(duration => duration >= beatLength).length >= 2;
    const slowdown = coordinated && releasesInVoices.filter(duration => duration >= beatLength * 2).length >= 2 &&
      (attacks.get(tick)?.filter(duration => duration < Math.max(...releasesInVoices)).length ?? 0) >= 2;
    const shortBreath = gap >= beatLength / 2 && releaseNotes.length >= 2 &&
      !rhythms.get(closingTick)?.soundAcross && (closingTick === tick || startingVoices >= 2 || barlines.has(tick));
    const dominantArrival = endsOnDominant && terminal && previous &&
      functionalFamily(previous) === "dominant" && chordIdentityInversion(previous.identity) === 0 &&
      pitchClassEquals(terminal.identity.root, previous.identity.root) &&
      previous.durationTicks + terminal.durationTicks >= 2 * beatLength;
    const { closure, unstable } = harmonyEndingScore(terminal, previous, endsOnDominant,
      pause || longRelease || wholeBarRelease || slowdown || shortBreath);
    const tonicRestart = following?.semantics && functionalFamily(following) === "tonic" &&
      primaryHarmonyInterpretation(following.semantics).degree === 1 &&
      chordIdentityInversion(following.identity) <= 1;
    const sameHarmony = terminal && following && (
      chordIdentityEquals(terminal.identity, { ...following.identity, bass: terminal.identity.bass }) ||
      (endsOnDominant && functionalFamily(following) === "dominant" &&
        pitchClassEquals(terminal.identity.root, following.identity.root))
    );
    const continuousHarmony = !(pause || shortBreath) && (insideProlongation || followsProlongation ||
      sameHarmony || regions.some(region =>
      region.startTick < tick && tick < region.startTick + region.durationTicks));
    const reprise = !hasFixedBoundary && reprisedOpeningAfterDominant({
      project, timeline, regions, scoreStart: range.startTick,
    }, tick);
    const barsFromOpening = (measureAt(timeline, tick)?.number ?? 0) - (opening?.number ?? 0);
    const onFourBarGrid = barsFromOpening > 0 && barsFromOpening % 4 === 0;
    const detachedDeception = shortBreath && endsOnDominant && following?.semantics &&
      primaryHarmonyInterpretation(following.semantics).degree === 6;
    const detachedClosure = shortBreath && !detachedDeception &&
      (gap >= beatLength * 2 || longRelease || wholeBarRelease ||
        Boolean(endsOnDominant && terminal && chordIdentityInversion(terminal.identity) === 0));
    const preparedDominant = previous?.semantics?.cadenceRole === "cadential64" ||
      beforePrevious?.semantics?.cadenceRole === "pedal64" || beforePrevious?.semantics?.cadenceRole === "cadential64";
    const rhythmicRestart = coordinated && !soundAcross && (slowdown || longRelease || wholeBarRelease);
    // The harmony itself can slow down even when the voices rearticulate
    // inside it. Demand a complete bar of root-position V after a quicker
    // contrasting chord, and an ensemble restart on tonic.
    const heldDominant = Boolean(endsOnDominant && terminal && previous && tonicRestart &&
      chordIdentityInversion(terminal.identity) === 0 && functionalFamily(previous) !== "dominant" &&
      terminal.durationTicks >= measureLengthAt(timeline, tick - 1) &&
      terminal.durationTicks >= previous.durationTicks * 2 &&
      barlines.has(tick) && endingVoices === 4 && startingVoices === 4);
    const renewedAfterCadence = Boolean(continuousHarmony && !insideProlongation && !followsProlongation &&
      sameHarmony && onFourBarGrid && endsOnDominant && previous?.semantics?.cadenceRole === "cadential64" &&
      rhythmicRestart && slowdown);
    const periodicDistance = measurePosition(timeline, tick) - openingPosition;
    const recurrentPulse = periodicDistance >= 4 && Number.isInteger(periodicDistance / 2) &&
      (barlines.has(tick) || pickup.has(tick));
    const barLength = measureLengthAt(timeline, tick - 1);
    const sequential = sopranoFigure(tick, tick - barLength) && bassFigure(tick, tick - barLength);
    if (sequential && !pause && !shortBreath && !reprise) return [];
    const heldAcross = !terminal && recurrentPulse && regions.find(region =>
      region.startTick < tick && tick < region.startTick + region.durationTicks);
    const dominantAtReturn = terminal ?? (heldAcross || undefined);
    const returnsAfterDominant = recurrentPulse && !hasFixedBoundary && !insideProlongation &&
      startingVoices >= 2 && endingVoices >= 2 && dominantAtReturn?.semantics &&
      functionalFamily(dominantAtReturn) === "dominant" &&
      primaryHarmonyInterpretation(dominantAtReturn.semantics).degree === 5 &&
      (chordIdentityInversion(dominantAtReturn.identity) === 0 ||
        (previous && functionalFamily(previous) === "dominant" && chordIdentityInversion(previous.identity) === 0 &&
          pitchClassEquals(previous.identity.root, dominantAtReturn.identity.root))) &&
      (tonicRestart || (endsOnDominant && onPickup && previous?.semantics?.cadenceRole === "cadential64") ||
        (heldAcross && chordIdentityInversion(heldAcross.identity) === 0 && wholeBarRelease)) &&
      !confirmed.some(mark => mark.fromTick < tick && tick < mark.toTick) && sopranoFigure(tick);
    const reset = !insideProlongation && !followsProlongation && closingTick === tick &&
      terminal && previous && cadentialRestart({
        project, terminal, previous, following, tick, beatLength,
        barLength, periodicDistance,
        tonicRestart: Boolean(tonicRestart), endsOnDominant,
        fromDominant: functionalFamily(previous) === "dominant",
        stableEnding: functionalFamily(terminal) !== undefined,
        pickup: pickup.has(tick), onBarline: barlines.has(tick),
      });
    const submediantRelease = recurrentPulse && endingVoices >= 2 && startingVoices >= 2 &&
      functionalFamily(beforePrevious) === "dominant" && beforePrevious?.semantics &&
      primaryHarmonyInterpretation(beforePrevious.semantics).degree === 5 &&
      functionalFamily(terminal) && functionalFamily(previous) && !insideProlongation &&
      releasesRevoicedSubmediant(project, beforePrevious, previous, terminal, following, tick, beatLength);
    const structuralBreath = detachedClosure || (renewedAfterCadence ||
      (!continuousHarmony && !soundAcross &&
        (heldDominant || (coordinated && endsOnDominant && tonicRestart && dominantArrival && preparedDominant) ||
          (rhythmicRestart && (closure >= eventWeights.cadence ||
            Boolean(terminal && functionalFamily(terminal) === "tonic" && functionalFamily(following) === "subdominant" &&
              metric && metric.level >= 2 && slowdown))))));
    if (structuralBreath) evidence.push({ code: "coordinated-breath", value: "收束后有多声部释放与重起的实写证据" });
    if (onPickup) evidence.push({ code: "pickup-alignment", value: "与开头弱起的拍位对齐" });
    if (onFourBarGrid) evidence.push({ code: "phrase-length-grid", value: "距开头为四小节的整数倍" });
    if (tonicRestart) evidence.push({ code: "tonic-restart", value: "后句从主和弦起奏" });
    if (soundAcross) evidence.push({ code: "sustained-voice", value: "有声部跨过候选边界持续" });
    if (unstable) evidence.push({ code: "unstable-ending", value: "前句末和声尚需解决" });
    if (reprise) evidence.push(reprise);
    if (reset) evidence.push(reset);
    if (submediantRelease) evidence.push({ code: "cadential-restart", value: "属至六级的落点换位延长，上声部释放后进入新功能" });
    if (returnsAfterDominant) evidence.push({ code: "periodic-opening-return", value: "属收束后在相同拍位再现开头的节奏与旋律音程" });

    const releaseScore = pause ? eventWeights.pause : longRelease ? eventWeights.longRelease :
      wholeBarRelease ? eventWeights.wholeBarRelease : 0;
    const atRestart = pause && tick === restart && closingTick < tick &&
      (barlines.has(tick) || onPickup || (measureAt(timeline, tick)?.startTick ?? tick) <= closingTick);
    const pauseBarline = pause && barlines.has(tick) && tick > closingTick && tick !== restart;
    const score = Math.max(returnsAfterDominant || submediantRelease ? eventWeights.reprise + eventWeights.cadence : 0,
      reset ? eventWeights.reprise + (pickup.has(tick) || closure === eventWeights.cadence ? 2 : 0) +
      Number(Number.isInteger(periodicDistance / 4)) : 0,
      reprise ? eventWeights.reprise : 0,
      releaseScore + closure + (structuralBreath ? 3 : 0) + (heldDominant ? 1 : 0) +
      (atRestart ? 2 : pauseBarline ? 1 : 0) +
      (tonicRestart ? eventWeights.tonicRestart : 0) +
      (onFourBarGrid ? eventWeights.fourBarGrid : 0) +
      (onPickup ? eventWeights.pickup : 0) +
      (soundAcross ? eventWeights.sustainedVoice : 0) +
      (continuousHarmony ? eventWeights.continuousHarmony : 0) +
      (unstable && !(dominantArrival && tonicRestart && structuralBreath) ? eventWeights.unstable : 0)) - eventWeights.divisionCost;
    // Established cuts keep their original evidence and compete with the new
    // candidates in the same path. This retains release and prolongation guards.
    const regular = establishedByTick.get(tick);
    if (regular) return [{
      ...regular,
      score: Math.max(score, eventWeights.establishedMinimum),
      evidence: [...regular.evidence, ...evidence.filter(item =>
        (item.code === "soprano-opening-reprise" || item.code === "coordinated-breath" ||
          item.code === "cadential-restart" || item.code === "periodic-opening-return") &&
        !regular.evidence.some(existing => existing.code === item.code))],
    }];
    // Off-grid chord changes cannot make a cut without audible articulation.
    if (detachedDeception || (pause && !detachedClosure && !reprise &&
        (!barlines.has(tick) || tick !== closingTick)) ||
        (!barlines.has(tick) && !onPickup && !structuralBreath && !reprise && !reset) ||
        (continuousHarmony && !renewedAfterCadence && !reprise && !reset && !returnsAfterDominant) || score <= 0) return [];
    return [{
      tick, targetRatio: "event", distanceToTarget: 0,
      support: pause ? "strong" : "moderate",
      score, confidence: "probable", evidence,
    }];
  });
}

function inferStructure(project: PhraseAnalysisInput, anchors: readonly number[]) {
  if (!project.ppq || !project.meterEvents?.length)
    return { candidates: [], template: phraseTemplate([]) };
  const timeline = buildMetricTimeline({
    ppq: project.ppq,
    meterEvents: project.meterEvents,
    lengthTicks: project.lengthTicks,
  });
  const candidates = (["half", "third", "two-thirds"] as const)
    .map((ratio) => candidateAtRatio(project, timeline, ratio))
    .filter((candidate): candidate is PhraseBoundaryCandidate => Boolean(candidate));
  const regular = selectTemplate(project, timeline, candidates);
  const regions = regionsOf(project);
  if (regions.length === 0) return { candidates, template: regular };
  const range = effectiveRange(project);
  const scored = eventCandidates(project, timeline, regions, range, regular.boundaries);
  return { candidates: scored, template: selectEventDivisions(timeline, range, anchors, scored) };
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
    ? inferStructure(project, boundaries
      .filter(boundary => boundary.source === "manual" || boundary.locked ||
        boundary.tick === 0 || boundary.tick === project.lengthTicks)
      .map(boundary => boundary.tick))
    : {
        candidates: [] as PhraseBoundaryCandidate[],
        template: { kind: "single", boundaries: [] } as PhraseStructureTemplate,
      };
  const knownTicks = new Set(boundaries.map((boundary) => boundary.tick));
  const candidates = generated.candidates.filter((candidate) => !knownTicks.has(candidate.tick));
  const selected = options.includeInferredBoundaries
    ? generated.template.boundaries.filter((candidate) => !knownTicks.has(candidate.tick))
    : [];
  const inferred = selected.map((candidate) => {
    const usesReprise = candidate.evidence.some(item => item.code === "soprano-opening-reprise" || item.code === "periodic-opening-return");
    return inferredBoundaryFromCandidate(candidate, phraseInferenceFingerprint(project, usesReprise));
  });
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
