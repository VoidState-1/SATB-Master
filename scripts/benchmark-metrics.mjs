import { isDeepStrictEqual } from "node:util";

export function blindSpec(spec, printedKeyChanges = []) {
  // Later local keys can be analytical annotations. Retain only changes explicitly
  // identified as printed key signatures in the manifest.
  const events = (spec.events ?? []).filter(event => !event.key || printedKeyChanges.includes(event.at));
  return {
    version: spec.version, key: spec.key, meter: spec.meter, tempo: spec.tempo, events,
    blocks: spec.blocks.map(({ from, to, voices }) => ({ from, to, voices })),
  };
}

const ratio = (hits, total) => total ? hits / total : null;
const sum = (rows, key) => rows.reduce((value, row) => value + row[key], 0);
const chordFields = ["identity", "inversion", "localKey", "function", "role", "strict"];

function interpretation(chords, region) {
  return region?.semantics && chords.primaryHarmonyInterpretation(region.semantics);
}

function functionalLabel(meaning) {
  if (!meaning) return undefined;
  const { designation, appliedTarget } = meaning;
  // The notation parser can omit optional properties that inference materializes
  // as undefined. Compare the musical designation and target field by field.
  return [
    meaning.degree, meaning.degreeAlteration,
    designation?.notationSystem, designation?.kind, designation?.primaryFunction,
    designation?.secondaryFunction, designation?.specialRole,
    appliedTarget?.degree, appliedTarget?.primaryFunction, appliedTarget?.secondaryFunction,
  ];
}

function keyLabel(meaning, events, tick) {
  if (!meaning) return undefined;
  const key = meaning.localKey ?? events.findLast(event => event.tick <= tick);
  return key && [key.tonic.step, key.tonic.alter, key.mode];
}

export function scoreChords(chords, reference, predictions, expectedKeys, inputKeys) {
  const segments = [];
  const totals = { ticks: 0, resolvedTicks: 0, alternativeOnlyTicks: 0, fields: {} };
  for (const field of chordFields) totals.fields[field] = { hits: 0, total: 0 };
  for (const expected of reference.chords) {
    const start = expected.startTick, end = start + expected.durationTicks;
    const cuts = new Set([start, end]);
    for (const region of predictions) {
      if (region.fromTick > start && region.fromTick < end) cuts.add(region.fromTick);
      if (region.toTick > start && region.toTick < end) cuts.add(region.toTick);
    }
    for (const key of [...expectedKeys, ...inputKeys]) if (key.tick > start && key.tick < end) cuts.add(key.tick);
    const sorted = [...cuts].sort((a, b) => a - b);
    const expectedMeaning = interpretation(chords, expected);
    for (let i = 1; i < sorted.length; i++) {
      const fromTick = sorted[i - 1], toTick = sorted[i], ticks = toTick - fromTick;
      const region = predictions.find(pred => pred.fromTick <= fromTick && fromTick < pred.toTick);
      const predicted = region?.selected;
      const resolved = Boolean(predicted && region.status === "resolved");
      const actualMeaning = interpretation(chords, predicted);
      const sameIdentity = candidate => !!candidate && chords.chordIdentityEquals(candidate.identity, expected.identity);
      const identity = resolved && sameIdentity(predicted);
      const inversion = resolved && chords.chordIdentityInversion(expected.identity) === chords.chordIdentityInversion(predicted.identity);
      const key = expectedMeaning ? resolved && isDeepStrictEqual(keyLabel(expectedMeaning, expectedKeys, fromTick), keyLabel(actualMeaning, inputKeys, fromTick)) : null;
      const functional = expectedMeaning ? resolved && isDeepStrictEqual(functionalLabel(expectedMeaning), functionalLabel(actualMeaning)) : null;
      const expectedRole = expected.semantics?.cadenceRole;
      const role = expectedRole ? resolved && expectedRole === predicted.semantics?.cadenceRole : null;
      const known = [identity, inversion, key, functional, role];
      const fields = { identity, inversion, localKey: key, function: functional, role,
        strict: known.every(value => value !== false) };
      const alternativeOnly = !identity && !!region && [predicted, ...region.alternatives].some(sameIdentity);
      segments.push({ fromTick, toTick, expectedId: expected.id, predictedId: region?.id,
        status: region?.status ?? "gap", fields, alternativeOnly });
      totals.ticks += ticks;
      if (resolved) totals.resolvedTicks += ticks;
      if (alternativeOnly) totals.alternativeOnlyTicks += ticks;
      for (const field of chordFields) {
        if (fields[field] === null) continue;
        totals.fields[field].total += ticks;
        if (fields[field]) totals.fields[field].hits += ticks;
      }
    }
  }
  return { segments, totals };
}

export function scoreCadences(reference, candidates) {
  const complete = reference.complete.includes("cadence");
  const predictions = candidates.filter(candidate => candidate.confidence !== "ambiguous");
  const unused = new Set(predictions);
  const matches = [];
  for (const label of reference.cadences) {
    const options = [...unused].filter(prediction => prediction.kind === label.kind && prediction.toTick === label.toTick);
    const isExact = prediction => prediction.fromTick === label.fromTick &&
      (!label.form || prediction.form === label.form) && (!label.completion || prediction.completion === label.completion);
    const chosen = options.find(isExact) ?? options[0];
    if (chosen) unused.delete(chosen);
    matches.push({ expectedId: label.id, predictedId: chosen?.id, matched: Boolean(chosen), exact: !!chosen && isExact(chosen) });
  }
  return { complete, labeled: matches.length, predicted: predictions.length, ambiguous: candidates.length - predictions.length,
    hits: matches.filter(match => match.matched).length, strictHits: matches.filter(match => match.exact).length,
    unmatchedPredictions: [...unused].map(candidate => candidate.id), matches };
}

function cadenceSummary(rows) {
  const complete = rows.filter(row => row.complete);
  const predicted = sum(complete, "predicted"), labeled = sum(complete, "labeled");
  const scores = field => {
    const hits = sum(complete, field);
    return { hits, precision: ratio(hits, predicted), recall: ratio(hits, labeled), f1: ratio(2 * hits, predicted + labeled) };
  };
  return { completeCases: complete.length, predicted, labeled, ...scores("hits"), strict: scores("strictHits"),
    partialCases: rows.length - complete.length, allKnownLabels: sum(rows, "labeled"), allKnownHits: sum(rows, "hits"),
    allKnownRecall: ratio(sum(rows, "hits"), sum(rows, "labeled")), ambiguous: sum(rows, "ambiguous") };
}

const severities = ["error", "warning", "suggestion"];
const voices = ["soprano", "alto", "tenor", "bass"];
const voiceKey = ids => [...ids].sort().join(",");

export function validateRuleAssertions(assertions) {
  if (!Array.isArray(assertions)) throw new Error("ruleAssertions 需要数组");
  const keys = new Set();
  for (const entry of assertions) {
    if (!entry || !["blind", "conditioned"].includes(entry.mode) ||
        typeof entry.ruleId !== "string" || !entry.ruleId.trim() || !Number.isSafeInteger(entry.tick) || entry.tick < 0 ||
        !severities.includes(entry.severity) || !["present","absent"].includes(entry.expected) ||
        !Array.isArray(entry.voiceIds) || new Set(entry.voiceIds).size !== entry.voiceIds.length ||
        !entry.voiceIds.every(voice => voices.includes(voice))) throw new Error("无效的 ruleAssertions 定位、输入条件、严重度或预期");
    const key = JSON.stringify([entry.mode, entry.ruleId, entry.tick, voiceKey(entry.voiceIds), entry.severity]);
    if (keys.has(key)) throw new Error("同一规则、输入条件、拍位、声部和严重度只允许一个预期");
    keys.add(key);
  }
}

// Each independently assessed location is one binary question, even when
// the engine emits more than one diagnostic at the same exact location.
export function scoreRuleAssertions(entries, output, lengthTicks, ruleProfile) {
  return entries.map(entry => {
    if (!output || entry.tick >= lengthTicks) return { ...entry, verdict: "unscored", reason: output ? "outside-score" : "not-run" };
    if (ruleProfile && (!Object.hasOwn(ruleProfile, entry.ruleId) || ruleProfile[entry.ruleId].severity === "off"))
      return { ...entry, verdict: "unscored", reason: "unknown-or-disabled-rule" };
    const matching = output.diagnostics.filter(diagnostic => diagnostic.ruleId === entry.ruleId &&
      diagnostic.tick === entry.tick && diagnostic.severity === entry.severity && voiceKey(diagnostic.voiceIds) === voiceKey(entry.voiceIds));
    const skip = output.skippedRules.find(rule => rule.ruleId === entry.ruleId);
    if (!matching.length && skip) return { ...entry, verdict: "unscored", reason: skip.reason };
    const present = matching.length > 0;
    const verdict = entry.expected === "present" ? (present ? "tp" : "fn") : (present ? "fp" : "tn");
    return { ...entry, verdict, matchingDiagnostics: matching.length };
  });
}

function summarizeAssertions(entries, diagnosticCount) {
  const summary = { labeled: entries.length, evaluated: 0, unscored: 0, tp: 0, tn: 0, fp: 0, fn: 0, coveredDiagnostics: 0 };
  for (const entry of entries) {
    summary[entry.verdict]++;
    summary.coveredDiagnostics += entry.matchingDiagnostics ?? 0;
  }
  summary.evaluated = summary.labeled - summary.unscored;
  return { ...summary, unverifiedDiagnostics: diagnosticCount - summary.coveredDiagnostics,
    precision: ratio(summary.tp, summary.tp + summary.fp), recall: ratio(summary.tp, summary.tp + summary.fn) };
}

export function aggregateCases(rows) {
  const totals = rows.flatMap(row => row.chords ? [row.chords] : []);
  const inputTicks = sum(rows.filter(row => Number.isFinite(row.ticks)), "ticks");
  const chordSummary = { cases: totals.length, ticks: sum(totals, "ticks"), resolvedTicks: sum(totals, "resolvedTicks"),
    inputTicks, referenceCoverage: ratio(sum(totals, "ticks"), inputTicks),
    alternativeOnlyTicks: sum(totals, "alternativeOnlyTicks"), fields: {} };
  for (const field of chordFields) {
    const values = totals.map(total => total.fields[field]);
    const hits = sum(values, "hits"), total = sum(values, "total");
    const groups = new Map();
    for (const row of rows.filter(row => row.chords)) {
      const key = JSON.stringify(row.parentQuestion);
      const fractions = groups.get(key) ?? [];
      const value = row.chords.fields[field];
      if (value.total) { fractions.push(value.hits / value.total); groups.set(key, fractions); }
    }
    const sumMeans = [...groups.values()].reduce((sum, fractions) => sum + fractions.reduce((a,b) => a+b,0) / fractions.length, 0);
    chordSummary.fields[field] = { hits, total, rate: ratio(hits, total), macroByQuestion: ratio(sumMeans, groups.size) };
  }
  const cadences = {}, rules = {}, statuses = {};
  for (const row of rows) for (const [stage, status] of Object.entries(row.execution)) {
    const counts = statuses[stage] ??= {};
    counts[status] = (counts[status] ?? 0) + 1;
  }
  for (const mode of ["blind", "conditioned"]) {
    cadences[mode] = cadenceSummary(rows.flatMap(row => row.cadences?.[mode] ? [row.cadences[mode]] : []));
    const results = rows.flatMap(row => row.rules?.[mode] ? [row.rules[mode]] : []);
    const diagnostics = { error: 0, warning: 0, suggestion: 0 };
    for (const result of results) for (const [severity, count] of Object.entries(result.counts)) diagnostics[severity] += count;
    const entries = rows.flatMap(row => row.ruleAssertions?.[mode] ?? []);
    const assertions = summarizeAssertions(entries, Object.values(diagnostics).reduce((total, count) => total + count, 0));
    assertions.bySeverity = Object.fromEntries(severities.map(severity => [severity,
      summarizeAssertions(entries.filter(entry => entry.severity === severity), diagnostics[severity])]));
    rules[mode] = { cases: results.length, diagnostics, skippedRuleRecords: sum(results, "skippedRuleRecords"),
      assertions, precision: null, recall: null, reason: "缺少覆盖全库的独立诊断预期，定向断言单列" };
  }
  return { cases: rows.length, distinctQuestions: new Set(rows.map(row => JSON.stringify(row.parentQuestion))).size,
    statuses, chords: chordSummary, cadences, rules };
}
