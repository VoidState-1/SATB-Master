import type {
  HarmonyInterpretation,
  KeyReference,
} from "../../../chordModel";
import type { HarmonySpan } from "../../analysis";
import { authenticBassFormula } from "../../cadence/bassFormula";
import type { RuleDiagnostic } from "../../runtime";
import {
  keyEquals,
  formatPitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
} from "../../../pitch";
import {
  chordEvidence,
  chordInversion,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { CadenceView, SpanView } from "../context/views";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import { CLOSED_PHRASE_SYNCOPATION, EQUAL_K46_ACCENT } from "../configSchema";
import type { RuleConfig } from "../types";

function spanInterpretation(context: HarmonyRuleContext, span: HarmonySpan) {
  const resolution = context.harmony.primaryInterpretation(span);
  return resolution.status === "resolved" ? resolution.value : undefined;
}

export function harmonicSyncopationRule(context: HarmonyRuleContext, config: RuleConfig) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const { span } = current;
    const neighborhood = context.spanNeighborhood(current);
    if (neighborhood.previous?.span.toTick !== span.fromTick) continue;
    const closedEnding = config[CLOSED_PHRASE_SYNCOPATION.key] === true &&
      (span.toTick === context.analysis.project.lengthTicks || context.boundaryAt(span.toTick)?.source === "manual");
    if (neighborhood.next?.span.fromTick !== span.toTick && !closedEnding) continue;
    if (!span.semantics || span.semantics.pedalContext || span.semantics.cadenceRole)
      continue;

    const entry = context.metric.positionAt(span.fromTick);
    if (!entry || entry.confidence === "ambiguous" || entry.level > 1)
      continue;
    const crossed = context.metric.strongestBetween(span.fromTick, span.toTick, {
      boundaries: "open",
    });
    if (context.metric.compare(crossed, entry) !== "stronger") continue;
    const chord = current.firstSlice.chord;
    if (!chord) continue;

    diagnostics.push(
      context.diagnostics.forSpan({
        ruleId: "rhythm.harmonic-syncopation",
        span: current,
        endTick: span.toTick,
        title: "和声切分",
        message: `${chordLabel(chord)} 在弱位进入，并延续跨越了后继更强拍位。`,
        params: {
          entryStrength: entry.level,
          exitStrength: context.metric.positionAt(span.toTick)?.level ?? -1,
          crossedStrength: crossed?.level ?? -1,
          entryMetricRole: entry.role,
          crossedMetricRole: crossed?.role ?? "unknown",
        },
      }),
    );
  }
  return diagnostics;
}

export function cadential64MetricPositionRule(context: HarmonyRuleContext, config: RuleConfig) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const source of context.spans()) {
    const interpretation = spanInterpretation(context, source.span);
    if (
      interpretation?.designation?.kind !== "cadential64" &&
      source.span.semantics?.cadenceRole !== "cadential64"
    )
      continue;
    const candidate = context.connections({ sourceSpanId: source.span.id }).first();
    if (!candidate?.connection.contiguous) continue;
    const sourcePosition = context.metric.positionAt(source.span.fromTick);
    const targetPosition = context.metric.positionAt(candidate.target.span.fromTick);
    if (
      !sourcePosition ||
      !targetPosition ||
      sourcePosition.confidence === "ambiguous" ||
      targetPosition.confidence === "ambiguous"
    )
      continue;
    const comparison = context.metric.compare(sourcePosition, targetPosition);
    const allowEqual = config[EQUAL_K46_ACCENT.key] === true;
    if (sourcePosition.level >= 2 && (comparison === "stronger" || (allowEqual && comparison === "equal"))) continue;
    diagnostics.push(
      context.diagnostics.forConnection({
        ruleId: "cadence.cadential64-metric-position",
        connection: candidate,
        failureTick: source.span.fromTick,
        endTick: source.span.toTick,
        title: "K46 拍位不当",
        message: allowEqual
          ? "终止四六应位于强拍或次强拍，且至少与后继和弦等强。"
          : "终止四六应位于强拍或次强拍，并比后继和弦更强。",
        params: {
          sourceStrength: sourcePosition.level,
          targetStrength: targetPosition.level,
          sourceMetricRole: sourcePosition.role,
          targetMetricRole: targetPosition.role,
        },
      }),
    );
  }
  return diagnostics;
}

function cadenceBass(span: SpanView | undefined, side: "first" | "last") {
  if (!span) return;
  const edge = side === "first" ? span.firstSlice : span.lastSlice;
  const note = edge.notes.bass;
  if (!note?.nonChordToneRole || !edge.chord || pitchClassEquals(note.pitch, edge.chord.identity.bass)) return note;
  // Move past written decorations only, stopping at the first structural bass.
  const slices = side === "first" ? span.slices : [...span.slices].reverse();
  const structural = slices.find(slice => slice.chord?.id !== edge.chord?.id ||
    (slice.notes.bass && !slice.notes.bass.nonChordToneRole));
  if (structural?.chord?.id === edge.chord?.id) return structural?.notes.bass;
  return note;
}

function hasPriorRootDominant(context: HarmonyRuleContext, cadence: CadenceView, key: KeyReference) {
  const root = scaleDegreePitchClass(key, 5);
  if (!cadence.landingSpan) return false;
  const before = [...cadence.spans].reverse();
  let edge = cadence.landingSpan.span.toTick;
  for (const span of before) {
    if (span.span.fromTick >= edge) continue;
    if (span.span.toTick !== edge) return false;
    const reading = spanInterpretation(context, span.span);
    if (!reading || reading.appliedTarget || reading.degree !== 5) return false;
    for (let index = span.slices.length - 1; index >= 0; index--) {
      const { chord, notes, key: printedKey } = span.slices[index];
      if (!chord || !keyEquals(reading.localKey ?? printedKey, key) ||
          !pitchClassEquals(chord.identity.root, root)) return false;
      if (notes.bass && !notes.bass.nonChordToneRole &&
          pitchClassEquals(chord.identity.bass, root) && pitchClassEquals(notes.bass.pitch, root)) return true;
    }
    edge = span.span.fromTick;
  }
  return false;
}

function cadenceRuleContexts(context: HarmonyRuleContext) {
  return context
    .cadences()
    .where(
      (cadence) =>
        !cadence.annotation?.stale &&
        (cadence.source !== "candidate" || cadence.confidence === "certain"),
    )
    .selectMany((cadence) => {
    const target = cadence.landingSpan;
    const source = cadence.precedingSpan;
    if (!target) return [];
    const sourceSlice = source?.lastSlice;
    const targetSlice = target.firstSlice;
    const sourceChord = sourceSlice?.chord;
    const targetChord = targetSlice.chord;
    if (!targetChord) return [];
    const sourceInterpretation = source
      ? spanInterpretation(context, source.span)
      : undefined;
    const targetInterpretation = spanInterpretation(context, target.span);
    const key = targetInterpretation?.localKey ?? targetSlice.key;
    const sourceBass = cadenceBass(source, "last");
    const targetBass = cadenceBass(target, "first");
    if (!targetBass) return [];
    const degreePitch = (degree: 1 | 4 | 5 | 6) =>
      scaleDegreePitchClass(key, degree, 0);
    const sourceFamily = sourceInterpretation?.designation?.primaryFunction;
    const targetFamily = targetInterpretation?.designation?.primaryFunction;
    return [
      {
        cadence,
        sourceSlice,
        targetSlice,
        sourceChord,
        targetChord,
        sourceBass,
        targetBass,
        degreePitch,
        sourceFamily,
        targetFamily,
        targetInterpretation,
        key,
      },
    ];
  })
    .toArray();
}

const CADENCE_KIND_LABELS = {
  full: "全终止",
  half: "半终止",
  supplementary: "补充终止",
  deceptive: "阻碍终止",
} as const;

function validCadenceBassFormula(context: HarmonyRuleContext, fact: ReturnType<typeof cadenceRuleContexts>[number]) {
  const {
    cadence, sourceChord, targetChord, sourceFamily, targetFamily, sourceBass,
    targetBass, targetInterpretation, degreePitch, key,
  } = fact;
  if (cadence.kind === "half") {
    return (
      (cadence.form !== "plagal" && targetFamily === "dominant" &&
        (pitchClassEquals(targetBass.pitch, degreePitch(5)) ||
          (pitchClassEquals(targetChord.identity.root, degreePitch(5)) &&
            pitchClassEquals(targetBass.pitch, targetChord.identity.bass) &&
            hasPriorRootDominant(context, cadence, key)))) ||
      (cadence.form !== "authentic" && targetFamily === "subdominant" &&
        pitchClassEquals(targetChord.identity.root, degreePitch(4)) &&
        chordInversion(targetChord) === 0 &&
        pitchClassEquals(targetBass.pitch, degreePitch(4)))
    );
  }

  if (!sourceBass) return false;
  if (cadence.kind === "deceptive") {
    return sourceFamily === "dominant" && targetInterpretation?.degree === 6 &&
      pitchClassEquals(sourceBass.pitch, degreePitch(5)) &&
      pitchClassEquals(targetBass.pitch, degreePitch(6));
  }

  const plagal = cadence.kind === "supplementary" || cadence.form === "plagal";
  if (!plagal) {
    if (sourceFamily !== "dominant" || targetFamily !== "tonic") return false;
    const formula = authenticBassFormula(key, sourceChord?.identity, targetChord.identity, sourceBass.pitch, targetBass.pitch);
    return formula === "root" || (formula === "inverted" && cadence.completion === "imperfect");
  }
  const tonic = degreePitch(1);
  if (targetFamily !== "tonic" || !pitchClassEquals(targetBass.pitch, tonic) || sourceFamily !== "subdominant") return false;
  const sourceRoot = degreePitch(4);
  if (pitchClassEquals(sourceBass.pitch, sourceRoot)) return true;

  if (!sourceChord || !pitchClassEquals(sourceChord.identity.root, sourceRoot) ||
    !pitchClassEquals(sourceBass.pitch, sourceChord.identity.bass)) return false;
  if (cadence.kind === "full" && cadence.completion === "imperfect") return true;

  return cadence.kind === "supplementary" && sourceChord.semantics?.cadenceRole === "pedal64" &&
    chordInversion(sourceChord) === 2 && pitchClassEquals(sourceBass.pitch, tonic) &&
    sourceBass.pitch.octave === targetBass.pitch.octave;
}

export function cadenceBassFormulaRule(ruleContext: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(ruleContext).forEach((context) => {
    if (validCadenceBassFormula(ruleContext, context)) return;
    diagnostics.push(
      diagnostic(
        "cadence.bass-formula",
        context.targetSlice.tick,
        context.targetSlice.endTick,
        ["bass"],
        context.sourceBass
          ? [context.sourceBass, context.targetBass]
          : [context.targetBass],
        "终止低音公式不成立",
        `标注的${CADENCE_KIND_LABELS[context.cadence.kind]}与末端功能或低音级数不一致。`,
        {
          chordIds: context.cadence.chords.map((chord) => chord.id),
          evidence: [
            ...(context.sourceChord
              ? [chordEvidence(context.sourceChord)]
              : []),
            chordEvidence(context.targetChord),
            ...(context.sourceBass
              ? [noteEvidence(context.sourceBass, "终止前低音")]
              : []),
            noteEvidence(context.targetBass, "终止低音"),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function perfectAuthenticSopranoRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(context).forEach((context) => {
    if (
      context.cadence.kind !== "full" ||
      context.cadence.form !== "authentic" ||
      context.cadence.completion !== "perfect" ||
      !context.sourceChord ||
      !context.sourceBass
    )
      return;
    const soprano = context.targetSlice.notes.soprano;
    if (!soprano) return;
    const valid =
      context.sourceFamily === "dominant" &&
      context.targetFamily === "tonic" &&
      chordInversion(context.sourceChord) === 0 &&
      chordInversion(context.targetChord) === 0 &&
      pitchClassEquals(soprano.pitch, context.degreePitch(1));
    if (valid) return;
    diagnostics.push(
      diagnostic(
        "cadence.perfect-authentic-soprano",
        context.targetSlice.tick,
        context.targetSlice.endTick,
        ["soprano", "bass"],
        [context.sourceBass, context.targetBass, soprano],
        "完全终止的旋律位置不成立",
        "完全终止要求原位 D 进入原位 T，并由女高音落在主音。",
        {
          chordIds: context.cadence.chords.map((chord) => chord.id),
          evidence: [
            chordEvidence(context.sourceChord),
            chordEvidence(context.targetChord),
            noteEvidence(soprano, "终止女高音"),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function unstableEndingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(context).forEach((context) => {
    if (
      context.cadence.kind !== "full" &&
      context.cadence.kind !== "supplementary"
    )
      return;
    const valid =
      context.targetFamily === "tonic" &&
      chordInversion(context.targetChord) === 0;
    if (valid) return;
    diagnostics.push(
      diagnostic(
        "cadence.unstable-ending",
        context.targetSlice.tick,
        context.targetSlice.endTick,
        ["bass"],
        [context.targetBass],
        "结束和弦不稳定",
        "闭合终止的末端应落在原位主功能和弦。",
        {
          chordIds: [context.targetChord.id],
          evidence: [
            chordEvidence(context.targetChord),
            noteEvidence(context.targetBass, "结束低音"),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function interpretationKey(
  context: HarmonyRuleContext,
  span: HarmonySpan,
  interpretation: HarmonyInterpretation,
) {
  return interpretation.localKey ?? context.keyAt(span.fromTick);
}

export function unmarkedKeyChangeRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const spans = context.spans().toArray();
  let index = 0;
  while (index < spans.length) {
    const span = spans[index].span;
    const interpretation = spanInterpretation(context, span);
    const projectKey = context.keyAt(span.fromTick);
    const localKey = interpretation?.localKey;
    if (
      !interpretation ||
      !localKey ||
      !projectKey ||
      keyEquals(localKey, projectKey) ||
      interpretation.appliedTarget ||
      span.semantics?.mixture ||
      (interpretation.confidence !== "certain" &&
        interpretation.confidence !== "probable")
    ) {
      index += 1;
      continue;
    }
    const group: HarmonySpan[] = [span];
    let cursor = index + 1;
    while (cursor < spans.length) {
      const candidate = spans[cursor].span;
      const candidateInterpretation = spanInterpretation(context, candidate);
      if (
        spans[cursor - 1].span.toTick !== candidate.fromTick ||
        !candidateInterpretation?.localKey ||
        !keyEquals(candidateInterpretation.localKey, localKey) ||
        keyEquals(
          candidateInterpretation.localKey,
          context.keyAt(candidate.fromTick) ?? candidateInterpretation.localKey,
        ) ||
        candidateInterpretation.appliedTarget ||
        candidate.semantics?.mixture
      )
        break;
      group.push(candidate);
      cursor += 1;
    }
    if (group.length >= 3) {
      diagnostics.push(
        diagnostic(
          "tonality.unmarked-key-change",
          group[0].fromTick,
          group.at(-1)!.toTick,
          [],
          [],
          "连续和声指向未标注的新调性",
          `连续 ${group.length} 个高置信度和弦均使用 ${formatPitchClass(localKey.tonic)} ${localKey.mode === "major" ? "大调" : "小调"}解释，但工程调号尚未变化。`,
          {
            chordIds: group.flatMap((item) => [...item.regionIds]),
            confidence: 0.8,
            evidence: [
              {
                kind: "key",
                label: "候选局部调性",
                value: `${formatPitchClass(localKey.tonic)} ${localKey.mode}`,
              },
            ],
          },
        ),
      );
    }
    index = cursor;
  }
  return diagnostics;
}

export function pivotReinterpretationRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const interpretations = span.semantics?.interpretations;
    if (!interpretations || interpretations.length < 2) continue;
    const keys = interpretations.map((item) =>
      interpretationKey(context, span, item),
    );
    if (keys.some((key) => !key)) continue;
    const resolvedKeys = keys as KeyReference[];
    if (resolvedKeys.every((key) => keyEquals(key, resolvedKeys[0]))) continue;
    const neighborhood = context.spanNeighborhood(current);
    const previous = neighborhood.previous?.span;
    const next = neighborhood.next?.span;
    if (
      !previous ||
      !next ||
      previous.toTick !== span.fromTick ||
      span.toTick !== next.fromTick
    )
      continue;
    const previousInterpretation = spanInterpretation(context, previous);
    const nextInterpretation = spanInterpretation(context, next);
    if (!previousInterpretation || !nextInterpretation) continue;
    const previousKey = interpretationKey(
      context,
      previous,
      previousInterpretation,
    );
    const nextKey = interpretationKey(context, next, nextInterpretation);
    if (!previousKey || !nextKey) continue;
    const entersWithCandidate = resolvedKeys.some((key) =>
      keyEquals(key, previousKey),
    );
    const exitsWithCandidate = resolvedKeys.some((key) =>
      keyEquals(key, nextKey),
    );
    const changesKey = !keyEquals(previousKey, nextKey);
    if (entersWithCandidate && exitsWithCandidate && changesKey) continue;
    const chord = current.firstSlice.chord;
    if (!chord) continue;
    diagnostics.push(
      diagnostic(
        "tonality.pivot-reinterpretation",
        span.fromTick,
        span.toTick,
        [],
        [],
        "共同和弦重解释方向不一致",
        "共同和弦的进入侧、离开侧调性与其双重解释不能形成一致的旧调到新调路径。",
        {
          chordIds: [...span.regionIds],
          evidence: [chordEvidence(chord)],
        },
      ),
    );
  }
  return diagnostics;
}

export function tonicizationModulationConflictRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const interpretations = span.semantics?.interpretations.filter(
      (item) => item.source === "confirmed",
    );
    if (!interpretations || interpretations.length < 2) continue;
    const projectKey = context.keyAt(span.fromTick);
    if (!projectKey) continue;
    const tonicization = interpretations.find((item) => item.appliedTarget);
    const modulation = interpretations.find(
      (item) => item.localKey && !keyEquals(item.localKey, projectKey),
    );
    if (!tonicization || !modulation || tonicization.id === modulation.id)
      continue;
    const chord = current.firstSlice.chord;
    if (!chord) continue;
    diagnostics.push(
      diagnostic(
        "tonality.tonicization-modulation-conflict",
        span.fromTick,
        span.toTick,
        [],
        [],
        "离调与转调语境冲突",
        "同一和弦同时被人工确认为离调目标链和新局部调性的组成部分，后续功能规则无法确定唯一语境。",
        {
          chordIds: [...span.regionIds],
          evidence: [
            chordEvidence(chord),
            {
              kind: "function",
              label: "离调解释",
              value: tonicization.id,
            },
            {
              kind: "key",
              label: "转调解释",
              value: `${formatPitchClass(modulation.localKey!.tonic)} ${modulation.localKey!.mode}`,
            },
          ],
        },
      ),
    );
  }
  return diagnostics;
}

export const RHYTHM_CADENCE_TONALITY_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "rhythm.harmonic-syncopation",
    catalogNumber: "J.1",
    label: "和声切分",
    description:
      "检查和弦是否在弱拍（或弱位置）更换并跨越进入随后的强拍（强位置）。",
    rationale:
      "和声节奏（Harmonic Rhythm）与节拍重音应当保持协调。如果在新和弦于弱拍进入并跨越保持至强拍，会导致和声变换重音与节拍重音错位，产生“和声切分”。这会削弱小节强拍的节拍重音感，在正规和声练习中应予避免。",
    group: "rhythm",
    options: [CLOSED_PHRASE_SYNCOPATION],
    defaultSeverity: "warning",
    requires: ["chords", "semantics", "meter"],
    dependencyScope: "phrase",
    evaluate: harmonicSyncopationRule,
  }),
  defineStatelessRule({
    id: "cadence.cadential64-metric-position",
    catalogNumber: "J.2",
    label: "K46 拍位不当",
    description:
      "检查 K46 的起拍强度以及它与后继和弦的强弱关系。",
    rationale:
      "终止四六在属低音上形成重音。严格作业要求 K46 位于强拍或次强拍，并强于后继和弦。教材分析允许两个和弦分别落在等强的强拍或次强拍。",
    group: "cadence",
    options: [EQUAL_K46_ACCENT],
    defaultSeverity: "warning",
    requires: ["chords", "semantics", "meter"],
    dependencyScope: "phrase",
    evaluate: cadential64MetricPositionRule,
  }),
  defineStatelessRule({
    id: "cadence.bass-formula",
    catalogNumber: "J.3",
    label: "终止低音不成立",
    description:
      "检查各类终止式（完全终止、半终止、变格终止等）的低音声部走向是否符合终止式公式。",
    rationale:
      "完满正格与变格终止的典型低音分别为 5→1 和 4→1。不完满终止可用转位的属或下属和弦。正格半终止可停在 5 级，变格半终止可停在 4 级。补充变格终止可用主音持续的辅助下属四六和弦，阻碍终止通常为 5→6。",
    group: "cadence",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: cadenceBassFormulaRule,
  }),
  defineStatelessRule({
    id: "cadence.perfect-authentic-soprano",
    catalogNumber: "J.4",
    label: "完全终止的旋律位置",
    description:
      "检查完全终止处最高声部（女高音）是否收束在调式主音（1级音）上。",
    rationale:
      "完满完全终止（Perfect Authentic Cadence, PAC）要求主和弦与属和弦均为原位，且最高声部（女高音）必须落在调式第一级主音上，从而在外声部形成 1 级与 1 级的纯八度闭合，提供最强烈的完满完结感。",
    group: "cadence",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: perfectAuthenticSopranoRule,
  }),
  defineStatelessRule({
    id: "cadence.unstable-ending",
    catalogNumber: "J.5",
    label: "结束和弦不稳定",
    description:
      "检查全曲或全乐段最终结束和弦是否使用了稳定、完满的原位主三和弦。",
    rationale:
      "整首作品或完整大段落的最终收束，必须使用原位主大/小三和弦（T），且内部所有倾向音均已完成彻底解决。使用转位和弦、副三和弦或带未解决七音的和弦作为最终结束，会留下无法平息的不稳定感。",
    group: "cadence",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: unstableEndingRule,
  }),
  defineStatelessRule({
    id: "tonality.unmarked-key-change",
    catalogNumber: "K.1",
    label: "调性变化未标注",
    description:
      "检查连续和声进行中是否已建立新的稳定调性中心但未进行转调标注。",
    rationale:
      "当和声通过特征变音、导和弦与终止式在新的音级上巩固了新的主和弦时，调性中心已经发生转移。明确标注转调有助于正确理解和弦的实际功能与倾向音走向。",
    group: "tonality",
    defaultSeverity: "suggestion",
    requires: ["chords", "semantics"],
    dependencyScope: "project",
    evaluate: unmarkedKeyChangeRule,
  }),
  defineStatelessRule({
    id: "tonality.pivot-reinterpretation",
    catalogNumber: "K.2",
    label: "共同和弦重解释不一致",
    description:
      "检查共同和弦转调中的中介和弦在前后两调中的结构音与转位是否完全一致。",
    rationale:
      "共同和弦转调（Pivot Chord Modulation）利用同一个在原调和新调中均合法的和弦作为桥梁。该和弦在物理发音上必须完全同一，前调按原调功能进入，后调立即赋予其新调功能引出新调属和弦。",
    group: "tonality",
    defaultSeverity: "error",
    requires: ["chords", "semantics"],
    dependencyScope: "project",
    evaluate: pivotReinterpretationRule,
  }),
  defineStatelessRule({
    id: "tonality.tonicization-modulation-conflict",
    catalogNumber: "K.3",
    label: "离调与转调语境冲突",
    description:
      "检查和声片段是属于短暂的副属和弦离调还是属于确立新调的长期转调。",
    rationale:
      "离调（Tonicization）是短暂借用副属和弦强化某个副级三和弦，随后立即返回原调；转调（Modulation）则是通过新调终止式彻底确立新调性。两者在功能从属与解决要求上具有不同层级的和声逻辑。",
    group: "tonality",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "project",
    evaluate: tonicizationModulationConflictRule,
  }),
);
