import {
  primaryHarmonyInterpretation,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../../chordModel";
import {
  analysisKeyAtTick,
  type HarmonyAnalysis,
  type HarmonySpan,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { buildMeasures, ticksPerBeat } from "../../../time";
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
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

function keyEquals(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function spanChord(analysis: HarmonyAnalysis, span: HarmonySpan) {
  return span.regionIds.map((id) => analysis.chordById.get(id)).find(Boolean);
}

function spanInterpretation(span: HarmonySpan) {
  return span.semantics
    ? primaryHarmonyInterpretation(span.semantics)
    : undefined;
}

function metricStrengthAtTick(analysis: HarmonyAnalysis, tick: number) {
  const measures = buildMeasures(analysis.project);
  const safeTick = Math.max(0, Math.min(tick, analysis.project.lengthTicks));
  const measure =
    measures.find(
      (item) => item.startTick <= safeTick && safeTick < item.endTick,
    ) ?? measures.at(-1);
  if (!measure) return 0;
  const beatLength = ticksPerBeat(analysis.project.ppq, measure.denominator);
  const offset = safeTick - measure.startTick;
  const beatPosition = offset / beatLength;
  if (Math.abs(beatPosition - Math.round(beatPosition)) > 1e-6) return 0;
  const beatIndex = Math.round(beatPosition);
  if (beatIndex === 0) return 3;
  if (measure.denominator === 8 && measure.numerator >= 6) {
    return beatIndex % 3 === 0 ? 2 : 1;
  }
  if (measure.numerator === 4 && beatIndex === 2) return 2;
  return 1;
}

export function harmonicSyncopationRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span, index) => {
    const previous = analysis.harmonySpans[index - 1];
    const next = analysis.harmonySpans[index + 1];
    if (
      !previous ||
      !next ||
      previous.toTick !== span.fromTick ||
      span.toTick !== next.fromTick ||
      span.semantics?.pedalContext ||
      span.semantics?.cadenceRole
    )
      return;
    const entryStrength = metricStrengthAtTick(analysis, span.fromTick);
    const exitStrength = metricStrengthAtTick(analysis, span.toTick);
    const crossedStrongPosition = buildMeasures(analysis.project).some(
      (measure) =>
        measure.beatTicks.some(
          (beatTick) =>
            span.fromTick < beatTick &&
            beatTick < span.toTick &&
            metricStrengthAtTick(analysis, beatTick) >= 2,
        ),
    );
    if (entryStrength > 1 || exitStrength > 1 || !crossedStrongPosition) return;
    const chord = spanChord(analysis, span);
    if (!chord) return;
    diagnostics.push(
      diagnostic(
        "rhythm.harmonic-syncopation",
        span.fromTick,
        span.toTick,
        [],
        [],
        "和声切分",
        `${chordLabel(chord)} 在弱位进入，跨越后继强位，并在另一弱位才离开。`,
        {
          chordIds: [...span.regionIds],
          params: { entryStrength, exitStrength },
          evidence: [chordEvidence(chord)],
        },
      ),
    );
  });
  return diagnostics;
}

export function cadential64MetricRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span) => {
    const interpretation = spanInterpretation(span);
    if (
      interpretation?.designation?.kind !== "cadential64" &&
      span.semantics?.cadenceRole !== "cadential64"
    )
      return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === span.id,
    );
    const targetSpan = connection
      ? analysis.harmonySpans.find(
          (candidate) => candidate.id === connection.currentSpanId,
        )
      : undefined;
    if (!connection?.contiguous || !targetSpan) return;
    const sourceStrength = metricStrengthAtTick(analysis, span.fromTick);
    const targetStrength = metricStrengthAtTick(analysis, targetSpan.fromTick);
    if (sourceStrength >= 2 && sourceStrength > targetStrength) return;
    const chord = spanChord(analysis, span);
    const target = spanChord(analysis, targetSpan);
    if (!chord) return;
    diagnostics.push(
      diagnostic(
        "cadence.cadential64-metric-position",
        span.fromTick,
        span.toTick,
        [],
        [],
        "K46 拍位不当",
        "终止四六应位于强拍或相对强位置，并比后继属和弦更强。",
        {
          chordIds: target ? [chord.id, target.id] : [chord.id],
          params: { sourceStrength, targetStrength },
          evidence: [
            chordEvidence(chord),
            ...(target ? [chordEvidence(target)] : []),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

function cadenceContext(analysis: HarmonyAnalysis, span: HarmonySpan) {
  const index = analysis.harmonySpans.findIndex(
    (candidate) => candidate.id === span.id,
  );
  const previousSpan = index > 0 ? analysis.harmonySpans[index - 1] : undefined;
  if (!previousSpan || previousSpan.toTick !== span.fromTick) return undefined;
  const sourceSlice = analysis.slices[previousSpan.sliceIndices.at(-1)!];
  const targetSlice = analysis.slices[span.sliceIndices[0]];
  if (!sourceSlice?.chord || !targetSlice?.chord) return undefined;
  const sourceChord = sourceSlice.chord;
  const targetChord = targetSlice.chord;
  return {
    previousSpan,
    sourceSlice,
    targetSlice,
    sourceChord,
    targetChord,
    sourceInterpretation: spanInterpretation(previousSpan),
    targetInterpretation: spanInterpretation(span),
  };
}

function cadenceRuleContexts(analysis: HarmonyAnalysis) {
  return analysis.harmonySpans.flatMap((span) => {
    const cadenceType = span.semantics?.cadenceType;
    if (!cadenceType || cadenceType === "open") return [];
    const context = cadenceContext(analysis, span);
    if (!context) return [];
    const {
      sourceSlice,
      targetSlice,
      sourceChord,
      targetChord,
      sourceInterpretation,
      targetInterpretation,
    } = context;
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
  });
}

export function cadenceBassFormulaRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(analysis).forEach((context) => {
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

export function perfectAuthenticSopranoRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(analysis).forEach((context) => {
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

export function unstableEndingRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  cadenceRuleContexts(analysis).forEach((context) => {
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

export function unmarkedKeyChangeRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  let index = 0;
  while (index < analysis.harmonySpans.length) {
    const span = analysis.harmonySpans[index];
    const interpretation = spanInterpretation(span);
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
    while (cursor < analysis.harmonySpans.length) {
      const candidate = analysis.harmonySpans[cursor];
      const candidateInterpretation = spanInterpretation(candidate);
      if (
        analysis.harmonySpans[cursor - 1].toTick !== candidate.fromTick ||
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

export function pivotReinterpretationRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span, index) => {
    const interpretations = span.semantics?.interpretations;
    if (!interpretations || interpretations.length < 2) return;
    const keys = interpretations.map((item) =>
      interpretationKey(analysis, span, item),
    );
    if (keys.every((key) => keyEquals(key, keys[0]))) return;
    const previous = analysis.harmonySpans[index - 1];
    const next = analysis.harmonySpans[index + 1];
    if (
      !previous ||
      !next ||
      previous.toTick !== span.fromTick ||
      span.toTick !== next.fromTick
    )
      return;
    const previousInterpretation = spanInterpretation(previous);
    const nextInterpretation = spanInterpretation(next);
    if (!previousInterpretation || !nextInterpretation) return;
    const previousKey = interpretationKey(
      analysis,
      previous,
      previousInterpretation,
    );
    const nextKey = interpretationKey(analysis, next, nextInterpretation);
    const entersWithCandidate = keys.some((key) => keyEquals(key, previousKey));
    const exitsWithCandidate = keys.some((key) => keyEquals(key, nextKey));
    const changesKey = !keyEquals(previousKey, nextKey);
    if (entersWithCandidate && exitsWithCandidate && changesKey) return;
    const chord = spanChord(analysis, span);
    if (!chord) return;
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
  });
  return diagnostics;
}

export function tonicizationModulationConflictRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span) => {
    const interpretations = span.semantics?.interpretations.filter(
      (item) => item.source === "confirmed",
    );
    if (!interpretations || interpretations.length < 2) return;
    const projectKey = analysisKeyAtTick(analysis, span.fromTick);
    const tonicization = interpretations.find((item) => item.appliedTarget);
    const modulation = interpretations.find(
      (item) => item.localKey && !keyEquals(item.localKey, projectKey),
    );
    if (!tonicization || !modulation || tonicization.id === modulation.id)
      return;
    const chord = spanChord(analysis, span);
    if (!chord) return;
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
  });
  return diagnostics;
}

export const RHYTHM_CADENCE_TONALITY_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "rhythm.harmonic-syncopation",
    catalogNumber: "J.1",
    label: "和声切分",
    description:
      "沿 `HarmonySpan` 链比较拍位：一个新和声在弱拍/弱位置进入，延续覆盖下一强拍或相对强位置，随后在弱位置离开时触发。",
    rationale:
      "持续音、延留音、同一功能内装饰转换、序进和人工确认的切分节奏可豁免；必须按变拍号的实际重音层级计算。",
    group: "rhythm",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
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
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: cadential64MetricRule,
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
