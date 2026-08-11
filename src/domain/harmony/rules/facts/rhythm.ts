import {
  compareMetricStrength,
  metricPositionAt,
  metricPositionsBetween,
} from "../../../rhythm/metric";
import {
  all,
  defineFact,
  fact,
  factNo,
  factUnknown,
  factYes,
  type PredicateNode,
} from "../declarative/facts";
import type {
  Cadential64TransitionCandidate,
  HarmonySpanCandidate,
} from "../declarative/candidates";
import type { ConstraintEnvironment } from "../declarative/constraint";

export type HarmonySpanEnvironment =
  ConstraintEnvironment<HarmonySpanCandidate>;

export type Cadential64MetricEnvironment =
  ConstraintEnvironment<Cadential64TransitionCandidate>;

function spanSubjectRefs(candidate: HarmonySpanCandidate) {
  return {
    spanIds: [candidate.span.id],
    chordIds: [...candidate.span.regionIds],
  };
}

function transitionSubjectRefs(candidate: Cadential64TransitionCandidate) {
  return {
    spanIds: [candidate.sourceSpan.id, candidate.targetSpan.id],
    chordIds: [
      ...candidate.sourceSpan.regionIds,
      ...candidate.targetSpan.regionIds,
    ],
  };
}

export function spanHasContiguousNeighbors(): PredicateNode<
  HarmonySpanEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.span-has-contiguous-neighbors",
      requires: ["chords"],
      cacheKey: (environment: HarmonySpanEnvironment) =>
        environment.candidate.span.id,
      evaluate(environment: HarmonySpanEnvironment) {
        const { span, previous, next } = environment.candidate;
        const contiguous =
          previous !== undefined &&
          next !== undefined &&
          previous.toTick === span.fromTick &&
          span.toTick === next.fromTick;
        const options = {
          subjectRefs: spanSubjectRefs(environment.candidate),
        };
        return contiguous
          ? factYes("harmony-span-neighbors-contiguous", options)
          : factNo("harmony-span-neighbors-not-contiguous", options);
      },
    }),
  );
}

export function spanHasNoExplicitSyncopationExemption(): PredicateNode<
  HarmonySpanEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.span-has-no-explicit-syncopation-exemption",
      requires: ["semantics"],
      cacheKey: (environment: HarmonySpanEnvironment) =>
        environment.candidate.span.id,
      evaluate(environment: HarmonySpanEnvironment) {
        const { span } = environment.candidate;
        const options = {
          subjectRefs: spanSubjectRefs(environment.candidate),
        };
        if (!span.semantics)
          return factUnknown("syncopation-semantics-unavailable", options);
        return span.semantics.pedalContext || span.semantics.cadenceRole
          ? factNo("harmony-span-has-syncopation-exemption", options)
          : factYes("harmony-span-has-no-syncopation-exemption", options);
      },
    }),
  );
}

export function spanEntersOnWeakMetricPosition(): PredicateNode<
  HarmonySpanEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.span-enters-on-weak-metric-position",
      requires: ["meter"],
      cacheKey: (environment: HarmonySpanEnvironment) =>
        environment.candidate.span.id,
      evaluate(environment: HarmonySpanEnvironment) {
        const position = metricPositionAt(
          environment.analysis.metricTimeline,
          environment.candidate.span.fromTick,
        );
        const options = {
          subjectRefs: spanSubjectRefs(environment.candidate),
        };
        if (!position)
          return factUnknown("span-entry-metric-position-unavailable", options);
        if (position.confidence === "ambiguous")
          return factUnknown("span-entry-metric-position-ambiguous", options);
        return position.level <= 1
          ? factYes("harmony-span-enters-on-weak-position", options)
          : factNo("harmony-span-enters-on-strong-position", options);
      },
    }),
  );
}

export function spanCrossesStrongerMetricPositionThanEntry(): PredicateNode<
  HarmonySpanEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.span-crosses-stronger-metric-position-than-entry",
      requires: ["meter"],
      cacheKey: (environment: HarmonySpanEnvironment) =>
        environment.candidate.span.id,
      evaluate(environment: HarmonySpanEnvironment) {
        const { span } = environment.candidate;
        const timeline = environment.analysis.metricTimeline;
        const entry = metricPositionAt(timeline, span.fromTick);
        const crossed = metricPositionsBetween(
          timeline,
          span.fromTick,
          span.toTick,
          { boundaries: "open" },
        );
        const comparisons = crossed.map((position) =>
          compareMetricStrength(position, entry),
        );
        const options = {
          subjectRefs: spanSubjectRefs(environment.candidate),
        };
        if (comparisons.includes("stronger"))
          return factYes("harmony-span-crosses-stronger-position", options);
        if (!entry || comparisons.includes("unknown"))
          return factUnknown("crossed-metric-strength-ambiguous", options);
        return factNo("harmony-span-does-not-cross-stronger-position", options);
      },
    }),
  );
}

export function spanFormsHarmonicSyncopation() {
  return all(
    spanHasContiguousNeighbors(),
    spanHasNoExplicitSyncopationExemption(),
    spanEntersOnWeakMetricPosition(),
    spanCrossesStrongerMetricPositionThanEntry(),
  );
}

export function cadential64StartsOnStrongMetricPosition(): PredicateNode<
  Cadential64MetricEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.cadential64-starts-on-strong-metric-position",
      requires: ["meter"],
      cacheKey: (environment: Cadential64MetricEnvironment) =>
        environment.candidate.sourceSpan.id,
      evaluate(environment: Cadential64MetricEnvironment) {
        const position = metricPositionAt(
          environment.analysis.metricTimeline,
          environment.candidate.sourceSpan.fromTick,
        );
        const options = {
          subjectRefs: transitionSubjectRefs(environment.candidate),
        };
        if (!position)
          return factUnknown("cadential64-metric-position-unavailable", options);
        if (position.confidence === "ambiguous")
          return factUnknown("cadential64-metric-position-ambiguous", options);
        return position.level >= 2
          ? factYes("cadential64-starts-on-strong-position", options)
          : factNo("cadential64-starts-on-weak-position", options);
      },
    }),
  );
}

export function cadential64StartsStrongerThanTarget(): PredicateNode<
  Cadential64MetricEnvironment
> {
  return fact(
    defineFact({
      id: "rhythm.cadential64-starts-stronger-than-target",
      requires: ["meter"],
      cacheKey: (environment: Cadential64MetricEnvironment) =>
        `${environment.candidate.sourceSpan.id}->${environment.candidate.targetSpan.id}`,
      evaluate(environment: Cadential64MetricEnvironment) {
        const timeline = environment.analysis.metricTimeline;
        const source = metricPositionAt(
          timeline,
          environment.candidate.sourceSpan.fromTick,
        );
        const target = metricPositionAt(
          timeline,
          environment.candidate.targetSpan.fromTick,
        );
        const comparison = compareMetricStrength(source, target);
        const options = {
          subjectRefs: transitionSubjectRefs(environment.candidate),
        };
        if (comparison === "unknown")
          return factUnknown(
            "cadential64-target-metric-relation-ambiguous",
            options,
          );
        return comparison === "stronger"
          ? factYes("cadential64-stronger-than-target", options)
          : factNo("cadential64-not-stronger-than-target", options);
      },
    }),
  );
}
