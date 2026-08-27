import type {
  HarmonyInterpretation,
  KeyReference,
} from "../../../chordModel";
import type { HarmonySpan } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import {
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
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

function keyEquals(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function spanInterpretation(context: HarmonyRuleContext, span: HarmonySpan) {
  const resolution = context.harmony.primaryInterpretation(span);
  return resolution.status === "resolved" ? resolution.value : undefined;
}

export function harmonicSyncopationRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const { span } = current;
    const neighborhood = context.spanNeighborhood(current);
    if (
      !neighborhood.previous ||
      !neighborhood.next ||
      neighborhood.previous.span.toTick !== span.fromTick ||
      span.toTick !== neighborhood.next.span.fromTick
    )
      continue;
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

export function cadential64MetricPositionRule(context: HarmonyRuleContext) {
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
    if (
      sourcePosition.level >= 2 &&
      context.metric.compare(sourcePosition, targetPosition) === "stronger"
    )
      continue;
    diagnostics.push(
      context.diagnostics.forConnection({
        ruleId: "cadence.cadential64-metric-position",
        connection: candidate,
        failureTick: source.span.fromTick,
        endTick: source.span.toTick,
        title: "K46 拍位不当",
        message: "终止四六应位于强拍或相对强位置，并比后继属和弦更强。",
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

function cadenceRuleContexts(context: HarmonyRuleContext) {
  return context
    .cadences()
    .where(
      (cadence) =>
        !cadence.annotation?.stale &&
        (cadence.source !== "candidate" || cadence.confidence === "certain"),
    )
    .selectMany((cadence) => {
    const target = cadence.spans.at(-1);
    const source = cadence.spans.at(-2);
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
    const sourceBass = sourceSlice?.notes.bass;
    const targetBass = targetSlice.notes.bass;
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

export function cadenceBassFormulaRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(context).forEach((context) => {
    const valid =
      context.cadence.kind === "full"
        ? Boolean(context.sourceBass) &&
          context.sourceFamily === "dominant" &&
          context.targetFamily === "tonic" &&
          pitchClassEquals(context.sourceBass!.pitch, context.degreePitch(5)) &&
          pitchClassEquals(context.targetBass.pitch, context.degreePitch(1))
        : context.cadence.kind === "half"
          ? context.targetFamily === "dominant" &&
            pitchClassEquals(context.targetBass.pitch, context.degreePitch(5))
          : context.cadence.kind === "supplementary"
            ? Boolean(context.sourceBass) &&
              context.sourceFamily === "subdominant" &&
              context.targetFamily === "tonic" &&
              pitchClassEquals(
                context.sourceBass!.pitch,
                context.degreePitch(4),
              ) &&
              pitchClassEquals(context.targetBass.pitch, context.degreePitch(1))
            : Boolean(context.sourceBass) &&
              context.sourceFamily === "dominant" &&
              context.targetInterpretation?.degree === 6 &&
              pitchClassEquals(
                context.sourceBass!.pitch,
                context.degreePitch(5),
              ) &&
              pitchClassEquals(
                context.targetBass.pitch,
                context.degreePitch(6),
              );
    if (valid) return;
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
      "检查终止四六和弦（K46）是否位于比后继属和弦更强的节拍位置。",
    rationale:
      "终止四六作为属低音上的重拍双重挂留和弦，其本质是不协和的紧张重音。因此在节拍上，K46 必须处于比它所解决的目标属和弦（Ⅴ或Ⅴ7）更强或至少同等的节拍位置（如强拍对弱拍、次强拍对弱拍），绝不能置于比属和弦更弱的位置。",
    group: "cadence",
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
      "终止式是乐句收束的结构支柱。完全终止低音必须是 5→1；半终止低音停留在 5 级；变格终止低音为 4→1；阻碍终止低音为 5→6。低音音级不符会导致乐段终止感瓦解或结构边界不清。",
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
