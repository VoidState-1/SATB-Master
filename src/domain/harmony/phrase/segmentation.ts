import type { MetricTimeline } from "../../rhythm/metric";
import { measureAt } from "./timelineEvidence";
import type { PhraseBoundaryCandidate, PhraseStructureTemplate } from "./types";

const minimumMeasures = 2;
const minimumGain = 1;
const epsilon = 1e-6;

export function phraseTemplate(
  boundaries: readonly PhraseBoundaryCandidate[],
): PhraseStructureTemplate {
  const [first, second] = boundaries;
  if (!first) return { kind: "single", boundaries: [] };
  if (!second) return { kind: "duple", boundaries: [first] };
  if (boundaries.length === 2) return { kind: "triple", boundaries: [first, second] };
  return { kind: "multi", boundaries };
}

export function shortOpeningMeasure(timeline: MetricTimeline) {
  const [first, following] = timeline.measures;
  if (first && following &&
      first.endTick - first.startTick <= following.numerator * following.beatLength / 2) return first;
}

export function measurePosition(timeline: MetricTimeline, tick: number) {
  const measure = measureAt(timeline, tick);
  if (!measure) return 0;
  if (measure === shortOpeningMeasure(timeline)) {
    const following = timeline.measures[1];
    return following.number - (measure.endTick - tick) / (following.numerator * following.beatLength);
  }
  return measure.number + (tick - measure.startTick) / (measure.numerator * measure.beatLength);
}

export function hasMinimumEventPhraseLength(timeline: MetricTimeline, fromTick: number, toTick: number) {
  return measurePosition(timeline, toTick) - measurePosition(timeline, fromTick) >= minimumMeasures - epsilon;
}

function lengthScore(measures: number) {
  if (measures < 3 - epsilon) return -1;
  if (Math.abs(measures - 4) < epsilon) return 1;
  if (measures > 6 + epsilon) return -1;
  return 0;
}

function bestDivisions(
  timeline: MetricTimeline,
  range: { startTick: number; endTick: number },
  fromTick: number,
  toTick: number,
  candidates: readonly PhraseBoundaryCandidate[],
) {
  if (!candidates.length) return [];
  const start = Math.max(fromTick, range.startTick);
  const end = Math.min(toTick, range.endTick);
  const points = [fromTick, ...candidates.map(candidate => candidate.tick), toTick];
  const positions = points.map(tick => measurePosition(timeline, Math.max(start, Math.min(end, tick))));
  const last = points.length - 1;
  const unsplit = lengthScore(positions[last] - positions[0]);
  const scores = points.map(() => -Infinity);
  const counts = points.map(() => Infinity);
  const predecessors = points.map(() => 0);
  scores[0] = 0;
  counts[0] = 0;
  for (let right = 1; right <= last; right++) {
    const division = candidates[right - 1];
    for (let left = 0; left < right; left++) {
      const measures = positions[right] - positions[left];
      const joined = left === 0 && right === last;
      // Retain established breath divisions in short periods when the score
      // contains a whole-beat rest, including an early release before the barline.
      const adjacent = division ?? candidates[left - 1];
      const shortBreath = adjacent?.targetRatio !== "event" &&
        adjacent?.evidence.some(item => item.code === "silence-after-target");
      if (!joined && measures < (shortBreath ? 1 : minimumMeasures) - epsilon) continue;
      const score = scores[left] + lengthScore(measures) + (division?.score ?? 0);
      const count = counts[left] + Number(Boolean(division));
      if (score > scores[right] || (score === scores[right] && count < counts[right])) {
        scores[right] = score;
        counts[right] = count;
        predecessors[right] = left;
      }
    }
  }
  if (scores[last] < unsplit + minimumGain) return [];
  const selected: PhraseBoundaryCandidate[] = [];
  for (let index = predecessors[last]; index > 0; index = predecessors[index]) {
    selected.push(candidates[index - 1]);
  }
  return selected.reverse();
}

export function selectEventDivisions(
  timeline: MetricTimeline,
  range: { startTick: number; endTick: number },
  anchors: readonly number[],
  candidates: readonly PhraseBoundaryCandidate[],
) {
  // Fixed boundaries divide the same additive objective into independent spans.
  return phraseTemplate(anchors.slice(1).flatMap((end, index) => {
    const start = anchors[index];
    return bestDivisions(timeline, range, start, end,
      candidates.filter(candidate => candidate.tick > start && candidate.tick < end));
  }));
}

