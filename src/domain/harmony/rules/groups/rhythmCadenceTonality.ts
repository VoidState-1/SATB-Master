import type {
  HarmonyInterpretation,
  KeyReference,
} from "../../../chordModel";
import {
  analysisKeyAtTick,
  type HarmonyAnalysis,
  type HarmonySpan,
} from "../../analysis";
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
import type { SpanView } from "../context/views";
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

function cadenceContext(context: HarmonyRuleContext, current: SpanView) {
  const { span } = current;
  const previous = context.spanNeighborhood(current).previous;
  if (!previous || previous.span.toTick !== span.fromTick) return undefined;
  const previousSpan = previous.span;
  const sourceSlice = previous.lastSlice;
  const targetSlice = current.firstSlice;
  if (!sourceSlice?.chord || !targetSlice?.chord) return undefined;
  const sourceChord = sourceSlice.chord;
  const targetChord = targetSlice.chord;
  return {
    previousSpan,
    sourceSlice,
    targetSlice,
    sourceChord,
    targetChord,
    sourceInterpretation: spanInterpretation(context, previousSpan),
    targetInterpretation: spanInterpretation(context, span),
  };
}

function cadenceRuleContexts(context: HarmonyRuleContext) {
  return context.spans().selectMany((current) => {
    const { span } = current;
    const cadenceType = span.semantics?.cadenceType;
    if (!cadenceType || cadenceType === "open") return [];
    const cadence = cadenceContext(context, current);
    if (!cadence) return [];
    const {
      sourceSlice,
      targetSlice,
      sourceChord,
      targetChord,
      sourceInterpretation,
      targetInterpretation,
    } = cadence;
    const key = targetInterpretation?.localKey ?? targetSlice.key;
    const sourceBass = sourceSlice.notes.bass;
    const targetBass = targetSlice.notes.bass;
    if (!sourceBass || !targetBass) return [];
    const degreePitch = (degree: 1 | 4 | 5 | 6) =>
      scaleDegreePitchClass(key, degree, 0);
    const sourceFamily = sourceInterpretation?.designation?.primaryFunction;
    const targetFamily = targetInterpretation?.designation?.primaryFunction;
    return [
      {
        cadenceType,
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
  }).toArray();
}

export function cadenceBassFormulaRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(context).forEach((context) => {
    const valid =
      context.cadenceType === "perfect-authentic" ||
      context.cadenceType === "imperfect-authentic"
        ? context.sourceFamily === "dominant" &&
          context.targetFamily === "tonic" &&
          pitchClassEquals(context.sourceBass.pitch, context.degreePitch(5)) &&
          pitchClassEquals(context.targetBass.pitch, context.degreePitch(1))
        : context.cadenceType === "half"
          ? context.targetFamily === "dominant" &&
            pitchClassEquals(context.targetBass.pitch, context.degreePitch(5))
          : context.cadenceType === "plagal"
            ? context.sourceFamily === "subdominant" &&
              context.targetFamily === "tonic" &&
              pitchClassEquals(
                context.sourceBass.pitch,
                context.degreePitch(4),
              ) &&
              pitchClassEquals(context.targetBass.pitch, context.degreePitch(1))
            : context.sourceFamily === "dominant" &&
              context.targetInterpretation?.degree === 6 &&
              pitchClassEquals(
                context.sourceBass.pitch,
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
        [context.sourceBass, context.targetBass],
        "终止低音公式不成立",
        `标注的 ${context.cadenceType} 终止与末端功能或低音级数不一致。`,
        {
          chordIds: [context.sourceChord.id, context.targetChord.id],
          evidence: [
            chordEvidence(context.sourceChord),
            chordEvidence(context.targetChord),
            noteEvidence(context.sourceBass, "终止前低音"),
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
    if (context.cadenceType !== "perfect-authentic") return;
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
          chordIds: [context.sourceChord.id, context.targetChord.id],
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
    if (context.cadenceType === "half" || context.cadenceType === "deceptive")
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
  analysis: HarmonyAnalysis,
  span: HarmonySpan,
  interpretation: HarmonyInterpretation,
) {
  return interpretation.localKey ?? analysisKeyAtTick(analysis, span.fromTick);
}

export function unmarkedKeyChangeRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  const spans = context.spans().toArray();
  let index = 0;
  while (index < spans.length) {
    const span = spans[index].span;
    const interpretation = spanInterpretation(context, span);
    const projectKey = analysisKeyAtTick(analysis, span.fromTick);
    const localKey = interpretation?.localKey;
    if (
      !interpretation ||
      !localKey ||
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
          analysisKeyAtTick(analysis, candidate.fromTick),
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
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const interpretations = span.semantics?.interpretations;
    if (!interpretations || interpretations.length < 2) continue;
    const keys = interpretations.map((item) =>
      interpretationKey(analysis, span, item),
    );
    if (keys.every((key) => keyEquals(key, keys[0]))) continue;
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
      analysis,
      previous,
      previousInterpretation,
    );
    const nextKey = interpretationKey(analysis, next, nextInterpretation);
    const entersWithCandidate = keys.some((key) => keyEquals(key, previousKey));
    const exitsWithCandidate = keys.some((key) => keyEquals(key, nextKey));
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
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const interpretations = span.semantics?.interpretations.filter(
      (item) => item.source === "confirmed",
    );
    if (!interpretations || interpretations.length < 2) continue;
    const projectKey = analysisKeyAtTick(analysis, span.fromTick);
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
      "沿 `HarmonySpan` 链比较拍位：一个新和声在弱拍或弱位置进入，并延续覆盖下一强拍或相对更强位置时触发。",
    rationale:
      "持续音、延留音、同一功能内装饰转换、序进和人工确认的切分节奏可豁免；必须按变拍号的实际重音层级计算。",
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
      "根据当前拍号和小节内重音层级，`K46` 应处于强拍或相对强位置，后继 D 处于相对较弱位置。",
    rationale:
      "不同拍号、复拍子和乐句尺度需要节拍 profile；没有可靠节拍信息时跳过。",
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
      "对已确认的完全、半终止、变格或阻碍终止，检查末端功能和低音级数是否符合该终止类型。",
    rationale:
      "只有人工标注或高置信度终止候选才检查；未标注乐句不能仅凭最后两个和弦武断报错。",
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
      "`cadenceRole` 明确为完全终止时，验证 D-T 均为规定转位，最终 T 为原位且女高音为主音。",
    rationale: "不完全终止不适用；名称和具体分类需与中文教材术语最终统一。",
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
      "在闭合终止的 phrase end 联合检查最终功能、转位和所有仍存的规则私有解决状态。",
    rationale:
      "半终止、开放终止和未完成练习不适用；具体倾向音仍由其专用规则生成诊断。",
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
      "多个连续 span 的高置信度解释共同指向新调性，且不是短暂离调属或借用和弦时提示用户确认转调。",
    rationale: "自动分析只能产生候选，绝不写回调号或覆盖人工解释。",
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
      "验证共同和弦 interpretations 映射到相同 identity 和转位，并检查进入侧使用旧调解释、离开侧使用新调解释。",
    rationale:
      "实体一致性通常应由模型 validator 阻止；连接方向只在已确认转调时检查。",
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
      "局部调性 span、目标功能义务和人工 modulation 标记给出互斥结论时触发语义冲突。",
    rationale: "不自动选择其中一个解释；依赖该结论的功能规则暂停。",
    group: "tonality",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "project",
    evaluate: tonicizationModulationConflictRule,
  }),
);
