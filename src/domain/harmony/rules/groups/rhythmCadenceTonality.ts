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
import { defineRuleBindings, statelessRule } from "../binding";

type CadenceRuleId =
  | "cadence.bass-formula"
  | "cadence.perfect-authentic-soprano"
  | "cadence.unstable-ending";

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
    const crossedStrongPosition = buildMeasures(analysis.project).some((measure) =>
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
  const index = analysis.harmonySpans.findIndex((candidate) => candidate.id === span.id);
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

export function cadenceRule(analysis: HarmonyAnalysis, ruleId: CadenceRuleId) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span) => {
    const cadenceType = span.semantics?.cadenceType;
    if (!cadenceType || cadenceType === "open") return;
    const context = cadenceContext(analysis, span);
    if (!context) return;
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
    if (!sourceBass || !targetBass) return;
    const degreePitch = (degree: 1 | 4 | 5 | 6) =>
      scaleDegreePitchClass(key, degree, 0);
    const sourceFamily = sourceInterpretation?.designation?.primaryFunction;
    const targetFamily = targetInterpretation?.designation?.primaryFunction;

    if (ruleId === "cadence.bass-formula") {
      const valid =
        cadenceType === "perfect-authentic" ||
        cadenceType === "imperfect-authentic"
          ? sourceFamily === "dominant" &&
            targetFamily === "tonic" &&
            pitchClassEquals(sourceBass.pitch, degreePitch(5)) &&
            pitchClassEquals(targetBass.pitch, degreePitch(1))
          : cadenceType === "half"
            ? targetFamily === "dominant" &&
              pitchClassEquals(targetBass.pitch, degreePitch(5))
            : cadenceType === "plagal"
              ? sourceFamily === "subdominant" &&
                targetFamily === "tonic" &&
                pitchClassEquals(sourceBass.pitch, degreePitch(4)) &&
                pitchClassEquals(targetBass.pitch, degreePitch(1))
              : sourceFamily === "dominant" &&
                targetInterpretation?.degree === 6 &&
                pitchClassEquals(sourceBass.pitch, degreePitch(5)) &&
                pitchClassEquals(targetBass.pitch, degreePitch(6));
      if (valid) return;
      diagnostics.push(
        diagnostic(
          ruleId,
          targetSlice.tick,
          targetSlice.endTick,
          ["bass"],
          [sourceBass, targetBass],
          "终止低音公式不成立",
          `标注的 ${cadenceType} 终止与末端功能或低音级数不一致。`,
          {
            chordIds: [sourceChord.id, targetChord.id],
            evidence: [
              chordEvidence(sourceChord),
              chordEvidence(targetChord),
              noteEvidence(sourceBass, "终止前低音"),
              noteEvidence(targetBass, "终止低音"),
            ],
          },
        ),
      );
      return;
    }

    if (ruleId === "cadence.perfect-authentic-soprano") {
      if (cadenceType !== "perfect-authentic") return;
      const soprano = targetSlice.notes.soprano;
      if (!soprano) return;
      const valid =
        sourceFamily === "dominant" &&
        targetFamily === "tonic" &&
        chordInversion(sourceChord) === 0 &&
        chordInversion(targetChord) === 0 &&
        pitchClassEquals(soprano.pitch, degreePitch(1));
      if (valid) return;
      diagnostics.push(
        diagnostic(
          ruleId,
          targetSlice.tick,
          targetSlice.endTick,
          ["soprano", "bass"],
          [sourceBass, targetBass, soprano],
          "完全终止的旋律位置不成立",
          "完全终止要求原位 D 进入原位 T，并由女高音落在主音。",
          {
            chordIds: [sourceChord.id, targetChord.id],
            evidence: [
              chordEvidence(sourceChord),
              chordEvidence(targetChord),
              noteEvidence(soprano, "终止女高音"),
            ],
          },
        ),
      );
      return;
    }

    if (cadenceType === "half" || cadenceType === "deceptive") return;
    const valid =
      targetFamily === "tonic" && chordInversion(targetChord) === 0;
    if (valid) return;
    diagnostics.push(
      diagnostic(
        ruleId,
        targetSlice.tick,
        targetSlice.endTick,
        ["bass"],
        [targetBass],
        "结束和弦不稳定",
        "闭合终止的末端应落在原位主功能和弦。",
        {
          chordIds: [targetChord.id],
          evidence: [
            chordEvidence(targetChord),
            noteEvidence(targetBass, "结束低音"),
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
    const keys = interpretations.map((item) => interpretationKey(analysis, span, item));
    if (keys.every((key) => keyEquals(key, keys[0]))) return;
    const previous = analysis.harmonySpans[index - 1];
    const next = analysis.harmonySpans[index + 1];
    if (!previous || !next || previous.toTick !== span.fromTick || span.toTick !== next.fromTick)
      return;
    const previousInterpretation = spanInterpretation(previous);
    const nextInterpretation = spanInterpretation(next);
    if (!previousInterpretation || !nextInterpretation) return;
    const previousKey = interpretationKey(analysis, previous, previousInterpretation);
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
    if (!tonicization || !modulation || tonicization.id === modulation.id) return;
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

export const RHYTHM_CADENCE_TONALITY_RULE_BINDINGS = defineRuleBindings({
  "rhythm.harmonic-syncopation": statelessRule(harmonicSyncopationRule),
  "cadence.cadential64-metric-position": statelessRule(
    cadential64MetricRule,
  ),
  "cadence.bass-formula": statelessRule((analysis) =>
    cadenceRule(analysis, "cadence.bass-formula"),
  ),
  "cadence.perfect-authentic-soprano": statelessRule((analysis) =>
    cadenceRule(analysis, "cadence.perfect-authentic-soprano"),
  ),
  "cadence.unstable-ending": statelessRule((analysis) =>
    cadenceRule(analysis, "cadence.unstable-ending"),
  ),
  "tonality.unmarked-key-change": statelessRule(unmarkedKeyChangeRule),
  "tonality.pivot-reinterpretation": statelessRule(pivotReinterpretationRule),
  "tonality.tonicization-modulation-conflict": statelessRule(
    tonicizationModulationConflictRule,
  ),
});
