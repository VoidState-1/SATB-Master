import {
  compareMetricStrength,
  metricPositionAt,
  metricPositionsBetween,
  strongestMetricPositionBetween,
  type MetricRangeBoundaries,
  type MetricTimeline,
} from "../../../rhythm/metric";

export interface MetricAnalysisService {
  positionAt(tick: number): ReturnType<typeof metricPositionAt>;
  positionsBetween(
    fromTick: number,
    toTick: number,
    options?: { readonly boundaries?: MetricRangeBoundaries },
  ): ReturnType<typeof metricPositionsBetween>;
  strongestBetween(
    fromTick: number,
    toTick: number,
    options?: { readonly boundaries?: MetricRangeBoundaries },
  ): ReturnType<typeof strongestMetricPositionBetween>;
  compare: typeof compareMetricStrength;
}

export function createMetricAnalysisService(
  timeline: MetricTimeline,
): MetricAnalysisService {
  const service: MetricAnalysisService = {
    positionAt: (tick) => metricPositionAt(timeline, tick),
    positionsBetween: (fromTick, toTick, options) =>
      metricPositionsBetween(timeline, fromTick, toTick, options),
    strongestBetween: (fromTick, toTick, options) =>
      strongestMetricPositionBetween(timeline, fromTick, toTick, options),
    compare: compareMetricStrength,
  };
  return Object.freeze(service);
}
