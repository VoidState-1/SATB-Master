import type { MeterEvent } from "../project/types";
import {
  buildMeasures,
  eventAtTick,
  measureAtTick,
  ticksPerBeat,
} from "../time";

type MetricMeterEvent = Readonly<Omit<MeterEvent, "beatGrouping">> & {
  readonly beatGrouping?: readonly number[];
};

interface MetricProject {
  readonly ppq: number;
  readonly meterEvents: readonly MetricMeterEvent[];
  readonly lengthTicks: number;
}

export type MetricLevel = 0 | 1 | 2 | 3;

export type MetricRole =
  | "subdivision"
  | "weak-beat"
  | "secondary-accent"
  | "downbeat";

export type MetricConfidence = "certain" | "ambiguous";

export interface MetricMeasure {
  readonly number: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly beatLength: number;
  readonly beatTicks: readonly number[];
  readonly beatGrouping?: readonly number[];
  readonly groupingConfidence: MetricConfidence;
}

export interface MetricTimeline {
  readonly ppq: number;
  readonly lengthTicks: number;
  readonly measures: readonly MetricMeasure[];
}

export interface MetricPosition {
  readonly tick: number;
  readonly measureNumber: number;
  readonly beatPosition: number;
  readonly role: MetricRole;
  readonly level: MetricLevel;
  readonly confidence: MetricConfidence;
}

export type MetricStrengthComparison =
  | "stronger"
  | "equal"
  | "weaker"
  | "unknown";

export type MetricRangeBoundaries =
  | "open"
  | "closed"
  | "left-closed"
  | "right-closed";

function groupingSum(grouping: readonly number[]) {
  return grouping.reduce((total, value) => total + value, 0);
}

function explicitGrouping(event: MetricMeterEvent) {
  const grouping = event.beatGrouping;
  if (
    !grouping ||
    grouping.length === 0 ||
    grouping.some((value) => !Number.isInteger(value) || value <= 0) ||
    groupingSum(grouping) !== event.numerator
  )
    return undefined;
  return Object.freeze([...grouping]);
}

function inferredGrouping(
  event: MetricMeterEvent,
): readonly number[] | undefined {
  if (
    (event.denominator === 8 || event.denominator === 16) &&
    event.numerator >= 6 &&
    event.numerator % 3 === 0
  )
    return Object.freeze(
      Array.from({ length: event.numerator / 3 }, () => 3),
    );
  if (event.numerator === 4) return Object.freeze([2, 2]);
  return undefined;
}

function groupingIsAmbiguous(
  event: MetricMeterEvent,
  grouping?: readonly number[],
) {
  if (grouping) return false;
  return event.numerator >= 5;
}

export function buildMetricTimeline(
  project: MetricProject,
): MetricTimeline {
  const measures = buildMeasures(project).map((measure) => {
    const event = eventAtTick(project.meterEvents, measure.startTick);
    const beatGrouping = explicitGrouping(event) ?? inferredGrouping(event);
    return Object.freeze({
      number: measure.number,
      startTick: measure.startTick,
      endTick: measure.endTick,
      numerator: measure.numerator,
      denominator: measure.denominator,
      beatLength: ticksPerBeat(project.ppq, measure.denominator),
      beatTicks: Object.freeze([...measure.beatTicks]),
      ...(beatGrouping ? { beatGrouping } : {}),
      groupingConfidence: groupingIsAmbiguous(event, beatGrouping)
        ? "ambiguous"
        : "certain",
    } satisfies MetricMeasure);
  });
  return Object.freeze({
    ppq: project.ppq,
    lengthTicks: project.lengthTicks,
    measures: Object.freeze(measures),
  });
}

function metricMeasureAtTick(timeline: MetricTimeline, tick: number) {
  if (!Number.isFinite(tick) || tick < 0 || tick >= timeline.lengthTicks)
    return undefined;
  return measureAtTick(timeline.measures, tick);
}

function groupStarts(grouping: readonly number[] | undefined) {
  if (!grouping) return new Set<number>();
  const starts = new Set<number>();
  let cursor = 0;
  grouping.slice(0, -1).forEach((size) => {
    cursor += size;
    starts.add(cursor);
  });
  return starts;
}

export function metricPositionAt(
  timeline: MetricTimeline,
  tick: number,
): MetricPosition | undefined {
  const measure = metricMeasureAtTick(timeline, tick);
  if (!measure) return undefined;
  const beatPosition = (tick - measure.startTick) / measure.beatLength;
  const roundedBeat = Math.round(beatPosition);
  const onBeat = Math.abs(beatPosition - roundedBeat) <= 1e-6;
  if (!onBeat)
    return Object.freeze({
      tick,
      measureNumber: measure.number,
      beatPosition,
      role: "subdivision",
      level: 0,
      confidence: "certain",
    });
  if (roundedBeat === 0)
    return Object.freeze({
      tick,
      measureNumber: measure.number,
      beatPosition: roundedBeat,
      role: "downbeat",
      level: 3,
      confidence: "certain",
    });
  const secondaryAccent = groupStarts(measure.beatGrouping).has(roundedBeat);
  return Object.freeze({
    tick,
    measureNumber: measure.number,
    beatPosition: roundedBeat,
    role: secondaryAccent ? "secondary-accent" : "weak-beat",
    level: secondaryAccent ? 2 : 1,
    confidence: measure.groupingConfidence,
  });
}

function includesTick(
  tick: number,
  fromTick: number,
  toTick: number,
  boundaries: MetricRangeBoundaries,
) {
  const includeStart = boundaries === "closed" || boundaries === "left-closed";
  const includeEnd = boundaries === "closed" || boundaries === "right-closed";
  return (
    (includeStart ? tick >= fromTick : tick > fromTick) &&
    (includeEnd ? tick <= toTick : tick < toTick)
  );
}

export function metricPositionsBetween(
  timeline: MetricTimeline,
  fromTick: number,
  toTick: number,
  options: { readonly boundaries?: MetricRangeBoundaries } = {},
) {
  if (!Number.isFinite(fromTick) || !Number.isFinite(toTick) || toTick < fromTick)
    return Object.freeze([]) as readonly MetricPosition[];
  const boundaries = options.boundaries ?? "open";
  return Object.freeze(
    timeline.measures.flatMap((measure) =>
      measure.beatTicks.flatMap((beatTick) => {
        if (!includesTick(beatTick, fromTick, toTick, boundaries)) return [];
        const position = metricPositionAt(timeline, beatTick);
        return position ? [position] : [];
      }),
    ),
  );
}

export function compareMetricStrength(
  left: MetricPosition | undefined,
  right: MetricPosition | undefined,
): MetricStrengthComparison {
  if (
    !left ||
    !right ||
    left.confidence === "ambiguous" ||
    right.confidence === "ambiguous"
  )
    return "unknown";
  if (left.level === right.level) return "equal";
  return left.level > right.level ? "stronger" : "weaker";
}

export function strongestMetricPositionBetween(
  timeline: MetricTimeline,
  fromTick: number,
  toTick: number,
  options: { readonly boundaries?: MetricRangeBoundaries } = {},
) {
  return metricPositionsBetween(timeline, fromTick, toTick, options).reduce<
    MetricPosition | undefined
  >((strongest, position) => {
    if (!strongest) return position;
    if (position.level > strongest.level) return position;
    if (
      position.level === strongest.level &&
      strongest.confidence === "ambiguous" &&
      position.confidence === "certain"
    )
      return position;
    return strongest;
  }, undefined);
}
