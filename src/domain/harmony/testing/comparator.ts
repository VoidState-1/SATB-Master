import type { HarmonyDiagnostic, SkippedRule } from "../runtime";
import type {
  DiagnosticFieldDifference,
  DiagnosticMismatch,
  ExpectedDiagnostic,
  ExpectedRuleSkip,
  RuleTestComparison,
  RuleTestExpectationSet,
} from "./model";

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = sortedUnique(left);
  const normalizedRight = sortedUnique(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function diagnosticSortKey(
  diagnostic: Pick<
    ExpectedDiagnostic,
    "tick" | "endTick" | "messageKey" | "noteIds" | "chordIds" | "voiceIds"
  >,
) {
  return JSON.stringify([
    diagnostic.tick,
    diagnostic.endTick ?? -1,
    diagnostic.messageKey,
    sortedUnique(diagnostic.voiceIds ?? []),
    sortedUnique(diagnostic.noteIds ?? []),
    sortedUnique(diagnostic.chordIds ?? []),
  ]);
}

function specificity(expectation: ExpectedDiagnostic) {
  return (
    Number(expectation.rootCauseKey !== undefined) +
    Number(expectation.endTick !== undefined) +
    Number(expectation.voiceIds !== undefined) +
    Number(expectation.noteIds !== undefined) +
    Number(expectation.chordIds !== undefined) +
    Object.keys(expectation.params ?? {}).length
  );
}

function semanticCandidate(
  expected: ExpectedDiagnostic,
  actual: HarmonyDiagnostic,
) {
  return (
    expected.ruleId === actual.ruleId &&
    expected.messageKey === actual.messageKey &&
    (expected.rootCauseKey === undefined ||
      expected.rootCauseKey === actual.rootCauseKey)
  );
}

export function diagnosticDifferences(
  expected: ExpectedDiagnostic,
  actual: HarmonyDiagnostic,
): DiagnosticFieldDifference[] {
  const differences: DiagnosticFieldDifference[] = [];
  const add = (
    field: DiagnosticFieldDifference["field"],
    expectedValue: unknown,
    actualValue: unknown,
  ) => differences.push({ field, expected: expectedValue, actual: actualValue });

  if (
    expected.rootCauseKey !== undefined &&
    expected.rootCauseKey !== actual.rootCauseKey
  )
    add("rootCauseKey", expected.rootCauseKey, actual.rootCauseKey);
  if (expected.tick !== actual.tick) add("tick", expected.tick, actual.tick);
  if (expected.endTick !== undefined && expected.endTick !== actual.endTick)
    add("endTick", expected.endTick, actual.endTick);

  for (const field of ["voiceIds", "noteIds", "chordIds"] as const) {
    const expectedValues = expected[field];
    if (
      expectedValues !== undefined &&
      !arraysEqual(expectedValues, actual[field])
    )
      add(field, sortedUnique(expectedValues), sortedUnique(actual[field]));
  }

  for (const [key, value] of Object.entries(expected.params ?? {})) {
    if (actual.params[key] !== value)
      add(`params.${key}`, value, actual.params[key]);
  }
  return differences;
}

function compareSkips(
  expected: readonly ExpectedRuleSkip[],
  actual: readonly SkippedRule[],
) {
  const remainingActual = [...actual];
  const mismatches: RuleTestComparison["skipMismatches"] = [];
  for (const expectation of expected) {
    const index = remainingActual.findIndex(
      (candidate) =>
        candidate.reason === expectation.reason &&
        candidate.partial === expectation.partial,
    );
    if (index >= 0) remainingActual.splice(index, 1);
    else mismatches.push({ kind: "missing", expected: expectation });
  }
  remainingActual.forEach((candidate) =>
    mismatches.push({ kind: "unexpected", actual: candidate }),
  );
  return mismatches;
}

export function compareRuleTestResult(
  expected: RuleTestExpectationSet,
  actual: import("../runtime").HarmonyCheckResult,
): RuleTestComparison {
  const expectations = [...expected.diagnostics].sort(
    (left, right) =>
      specificity(right) - specificity(left) ||
      diagnosticSortKey(left).localeCompare(diagnosticSortKey(right), "en") ||
      left.id.localeCompare(right.id, "en"),
  );
  const diagnostics = [...actual.diagnostics].sort((left, right) =>
    diagnosticSortKey(left).localeCompare(diagnosticSortKey(right), "en"),
  );
  const unusedActual = new Set(diagnostics.map((_, index) => index));
  const matches: RuleTestComparison["matches"] = [];
  const pending: ExpectedDiagnostic[] = [];

  for (const expectation of expectations) {
    const exactIndex = diagnostics.findIndex(
      (candidate, index) =>
        unusedActual.has(index) &&
        semanticCandidate(expectation, candidate) &&
        diagnosticDifferences(expectation, candidate).length === 0,
    );
    if (exactIndex < 0) pending.push(expectation);
    else {
      unusedActual.delete(exactIndex);
      matches.push({ expected: expectation, actual: diagnostics[exactIndex] });
    }
  }

  const mismatched: DiagnosticMismatch[] = [];
  const missing: ExpectedDiagnostic[] = [];
  for (const expectation of pending) {
    const candidates = diagnostics
      .map((candidate, index) => ({
        candidate,
        index,
        differences: diagnosticDifferences(expectation, candidate),
      }))
      .filter(
        ({ candidate, index }) =>
          unusedActual.has(index) && semanticCandidate(expectation, candidate),
      )
      .sort(
        (left, right) =>
          left.differences.length - right.differences.length ||
          Math.abs(left.candidate.tick - expectation.tick) -
            Math.abs(right.candidate.tick - expectation.tick) ||
          left.index - right.index,
      );
    const closest = candidates[0];
    if (!closest) missing.push(expectation);
    else {
      unusedActual.delete(closest.index);
      mismatched.push({
        expected: expectation,
        actual: closest.candidate,
        differences: closest.differences,
      });
    }
  }

  const unexpected = diagnostics.filter((_, index) => unusedActual.has(index));
  const skipMismatches = compareSkips(expected.skips, actual.skippedRules);
  return {
    passed:
      missing.length === 0 &&
      mismatched.length === 0 &&
      skipMismatches.length === 0 &&
      (expected.allowUnexpectedDiagnostics || unexpected.length === 0),
    matches,
    missing,
    unexpected,
    mismatched,
    skipMismatches,
  };
}

export function expectedDiagnosticFromActual(
  diagnostic: HarmonyDiagnostic,
  id: string,
): ExpectedDiagnostic {
  return {
    id,
    ruleId: diagnostic.ruleId,
    messageKey: diagnostic.messageKey,
    ...(diagnostic.rootCauseKey
      ? { rootCauseKey: diagnostic.rootCauseKey }
      : {}),
    tick: diagnostic.tick,
    endTick: diagnostic.endTick,
    voiceIds: sortedUnique(diagnostic.voiceIds) as ExpectedDiagnostic["voiceIds"],
    noteIds: sortedUnique(diagnostic.noteIds),
    chordIds: sortedUnique(diagnostic.chordIds),
    params: { ...diagnostic.params },
  };
}
