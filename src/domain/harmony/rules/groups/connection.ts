import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type { AnalysisNote, HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { VOICE_ORDER } from "../../../project/voice";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordLabel,
  diagnostic,
  hasExactPitch,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

export function augmentedSixthResolutionRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "resolution.augmented-sixth"
    | "connection.italian-augmented-sixth"
    | "connection.french-augmented-sixth"
    | "connection.german-augmented-sixth" = "resolution.augmented-sixth",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    const sourceSpanChord = sourceSpan.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (sourceSpanChord?.identity.structure.kind !== "augmented-sixth") return;
    const expectedVariant =
      ruleId === "connection.italian-augmented-sixth"
        ? "italian"
        : ruleId === "connection.french-augmented-sixth"
          ? "french"
          : ruleId === "connection.german-augmented-sixth"
            ? "german"
            : undefined;
    if (
      expectedVariant &&
      sourceSpanChord.identity.structure.variant !== expectedVariant
    )
      return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    if (!connection?.contiguous || !connection.sameKey) return;
    const targetSpan = analysis.harmonySpans.find(
      (candidate) => candidate.id === connection.currentSpanId,
    );
    if (!targetSpan) return;
    let sourceSliceIndex = -1;
    analysis.slices.forEach((_slice, index) => {
      if (analysis.sliceSpanIds.get(index) === sourceSpan.id)
        sourceSliceIndex = index;
    });
    const targetSliceIndex = analysis.slices.findIndex(
      (_slice, index) => analysis.sliceSpanIds.get(index) === targetSpan.id,
    );
    if (sourceSliceIndex < 0 || targetSliceIndex < 0) return;
    const sourceSlice = analysis.slices[sourceSliceIndex];
    const targetSlice = analysis.slices[targetSliceIndex];
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      return;

    const tones = chordIdentityToneSpellings(sourceChord.identity);
    const sourceNotes = activeNotes(sourceSlice);
    const lowCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones[0]),
    );
    const highCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones.at(-1)!),
    );
    // 两端音缺失或重复属于 D.13 的静态配置错误；本规则只在端点唯一时检查横向解决。
    if (lowCandidates.length !== 1 || highCandidates.length !== 1) return;
    const low = lowCandidates[0];
    const high = highCandidates[0];
    const targetLow = targetSlice.notes[low.voiceId];
    const targetHigh = targetSlice.notes[high.voiceId];
    const targetInterpretation = targetSpan.semantics
      ? primaryHarmonyInterpretation(targetSpan.semantics)
      : undefined;
    const targetKind = targetInterpretation?.designation?.kind;
    const isCadential64 =
      targetKind === "cadential64" ||
      targetSpan.semantics?.cadenceRole === "cadential64";
    const isDominant =
      targetInterpretation?.designation?.primaryFunction === "dominant" ||
      targetInterpretation?.degree === 5 ||
      targetInterpretation?.degree === 7;
    const dominantPitch = scaleDegreePitchClass(sourceSlice.key, 5, 0);
    const lowDelta = targetLow
      ? toMidi(targetLow.pitch) - toMidi(low.note.pitch)
      : undefined;
    const highDelta = targetHigh
      ? toMidi(targetHigh.pitch) - toMidi(high.note.pitch)
      : undefined;
    const lowResolves = Boolean(
      targetLow &&
        lowDelta === -1 &&
        pitchClassEquals(targetLow.pitch, dominantPitch),
    );
    const highResolves = Boolean(
      targetHigh &&
        highDelta === 1 &&
        pitchClassEquals(targetHigh.pitch, dominantPitch),
    );
    let characteristicResolves = true;
    let characteristicSource: AnalysisNote | undefined;
    let characteristicTarget: AnalysisNote | undefined;
    if (ruleId === "connection.french-augmented-sixth") {
      const candidates = sourceNotes.filter(({ note }) =>
        pitchClassEquals(note.pitch, tones[2]),
      );
      characteristicSource = candidates.length === 1
        ? candidates[0].note
        : undefined;
      characteristicTarget = candidates.length === 1
        ? targetSlice.notes[candidates[0].voiceId]
        : undefined;
      const motion =
        characteristicSource && characteristicTarget
          ? Math.abs(
              toMidi(characteristicTarget.pitch) -
                toMidi(characteristicSource.pitch),
            )
          : undefined;
      characteristicResolves = Boolean(
        characteristicSource &&
          characteristicTarget &&
          motion !== undefined &&
          motion <= 2 &&
          hasExactPitch(
            characteristicTarget,
            chordIdentityToneSpellings(targetChord.identity),
          ),
      );
    }
    if (
      (isDominant || isCadential64) &&
      lowResolves &&
      highResolves &&
      characteristicResolves
    )
      return;

    const problems = [
      ...(!isDominant && !isCadential64
        ? ["目标不是明确的属功能或 K46"]
        : []),
      ...(!lowResolves ? ["增六低端未下行半音到属音"] : []),
      ...(!highResolves ? ["增六高端未上行半音到属音"] : []),
      ...(!characteristicResolves
        ? ["Fr+6 特有构成音未保持或级进到目标和弦音"]
        : []),
    ];
    const sourceAllNotes = sourceNotes.map(({ note }) => note);
    const targetAllNotes = activeNotes(targetSlice).map(({ note }) => note);
    const variantLabel =
      sourceChord.identity.structure.kind === "augmented-sixth"
        ? sourceChord.identity.structure.variant === "italian"
          ? "It+6"
          : sourceChord.identity.structure.variant === "french"
            ? "Fr+6"
            : "Ger+6"
        : "增六和弦";
    const genericCause =
      `resolution.augmented-sixth|${connection.connectionKey}`;
    const specificCause = `${ruleId}|${connection.connectionKey}`;
    diagnostics.push(
      diagnostic(
        ruleId,
        targetSlice.tick,
        targetSlice.endTick,
        [...VOICE_ORDER],
        [...sourceAllNotes, ...targetAllNotes],
        ruleId === "resolution.augmented-sixth"
          ? "增六音程未按反向半音解决"
          : `${variantLabel} 连接不正确`,
        `${chordLabel(sourceChord)}：${problems.join("；")}。`,
        {
          chordIds: [sourceChord.id, targetChord.id],
          params: {
            target: isCadential64 ? "K46" : isDominant ? "D" : "other",
            lowDelta: lowDelta ?? 99,
            highDelta: highDelta ?? 99,
          },
          evidence: [
            chordEvidence(sourceChord),
            noteEvidence(low.note, "增六低端"),
            noteEvidence(high.note, "增六高端"),
            chordEvidence(targetChord),
            ...(targetLow ? [noteEvidence(targetLow, "低端后继音")] : []),
            ...(targetHigh ? [noteEvidence(targetHigh, "高端后继音")] : []),
            ...(characteristicSource
              ? [noteEvidence(characteristicSource, "Fr+6 特有音")]
              : []),
            ...(characteristicTarget
              ? [noteEvidence(characteristicTarget, "特有音后继音")]
              : []),
          ],
          causeRefs: [specificCause],
          coverageRefs:
            ruleId === "resolution.augmented-sixth"
              ? undefined
              : [genericCause],
        },
      ),
    );
  });
  return diagnostics;
}

export function deceptiveCadenceTargetRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") return;
    const sourceInterpretation = sourceSpan.semantics
      ? primaryHarmonyInterpretation(sourceSpan.semantics)
      : undefined;
    const sourceIsDominant =
      sourceInterpretation?.designation?.primaryFunction === "dominant" ||
      sourceInterpretation?.degree === 5 ||
      sourceInterpretation?.degree === 7;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    const targetSpan = connection
      ? analysis.harmonySpans.find(
          (candidate) => candidate.id === connection.currentSpanId,
        )
      : undefined;
    const sourceChord = sourceSpan.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const targetChord = targetSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (
      !sourceChord ||
      !connection ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      return;
    const resolves = Boolean(
      sourceIsDominant &&
        connection.relation === "deceptive" &&
        connection.contiguous &&
        connection.sameKey,
    );
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "function.deceptive-cadence-target",
        targetChord
          ? targetChord.startTick
          : Math.min(
              analysis.project.lengthTicks,
              sourceChord.startTick + sourceChord.durationTicks,
            ),
        targetChord
          ? targetChord.startTick
          : Math.min(
              analysis.project.lengthTicks,
              sourceChord.startTick + sourceChord.durationTicks,
            ),
        [],
        [],
        "阻碍进行标注与目标不一致",
        `${chordLabel(sourceChord)} 已标注为阻碍进行起点，后继应为同一调性内的 TSVI。`,
        {
          chordIds: targetChord
            ? [sourceChord.id, targetChord.id]
            : [sourceChord.id],
          evidence: [
            chordEvidence(sourceChord),
            ...(targetChord ? [chordEvidence(targetChord)] : []),
            {
              kind: "function",
              label: "预期连接",
              value: "D → TSVI",
            },
          ],
          causeRefs: [
            `function.deceptive-cadence-target|${connection.connectionKey}`,
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function deceptiveVoiceLeadingRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((sourceSpan) => {
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === sourceSpan.id,
    );
    if (
      connection?.relation !== "deceptive" ||
      !connection.contiguous ||
      !connection.sameKey
    )
      return;
    const targetSpan = analysis.harmonySpans.find(
      (candidate) => candidate.id === connection.currentSpanId,
    );
    if (!targetSpan) return;
    let sourceSliceIndex = -1;
    analysis.slices.forEach((_slice, index) => {
      if (analysis.sliceSpanIds.get(index) === sourceSpan.id)
        sourceSliceIndex = index;
    });
    const targetSliceIndex = analysis.slices.findIndex(
      (_slice, index) => analysis.sliceSpanIds.get(index) === targetSpan.id,
    );
    if (sourceSliceIndex < 0 || targetSliceIndex < 0) return;
    const sourceSlice = analysis.slices[sourceSliceIndex];
    const targetSlice = analysis.slices[targetSliceIndex];
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      return;

    const sourceBass = sourceSlice.notes.bass;
    const targetBass = targetSlice.notes.bass;
    const dominant = scaleDegreePitchClass(sourceSlice.key, 5, 0);
    const submediant = scaleDegreePitchClass(sourceSlice.key, 6, 0);
    const tonic = sourceSlice.key.tonic;
    const leadingTone = scaleDegreePitchClass(
      sourceSlice.key,
      7,
      sourceSlice.key.mode === "minor" ? 1 : 0,
    );
    const bassResolves = Boolean(
      sourceBass &&
        targetBass &&
        pitchClassEquals(sourceBass.pitch, dominant) &&
        pitchClassEquals(targetBass.pitch, submediant),
    );
    const leadingSources = activeNotes(sourceSlice).filter(({ note }) =>
      pitchClassEquals(note.pitch, leadingTone),
    );
    const leadingResolves =
      leadingSources.length === 1 &&
      (() => {
        const source = leadingSources[0];
        const target = targetSlice.notes[source.voiceId];
        return Boolean(
          target &&
            pitchClassEquals(target.pitch, tonic) &&
            toMidi(target.pitch) - toMidi(source.note.pitch) === 1,
        );
      })();
    const targetTones = chordIdentityToneSpellings(targetChord.identity);
    const targetCounts = targetTones.map(
      (tone) =>
        activeNotes(targetSlice).filter(({ note }) =>
          pitchClassEquals(note.pitch, tone),
        ).length,
    );
    const targetProfile =
      targetChord.identity.structure.kind === "tertian" &&
      targetTones.length === 3 &&
      targetCounts[0] === 1 &&
      targetCounts[1] === 2 &&
      targetCounts[2] === 1 &&
      pitchClassEquals(targetTones[1], tonic);
    if (bassResolves && leadingResolves && targetProfile) return;

    const problems = [
      ...(!bassResolves ? ["低音未按 5→6 进行"] : []),
      ...(!leadingResolves ? ["导音未按 7→1 上行解决"] : []),
      ...(!targetProfile ? ["TSVI 未采用三音重复配置"] : []),
    ];
    const sourceNotes = activeNotes(sourceSlice).map(({ note }) => note);
    const targetNotes = activeNotes(targetSlice).map(({ note }) => note);
    const targetCause =
      `function.deceptive-cadence-target|${connection.connectionKey}`;
    diagnostics.push(
      diagnostic(
        "connection.deceptive-voice-leading",
        targetSlice.tick,
        targetSlice.endTick,
        [
          "bass",
          ...leadingSources.map(({ voiceId }) => voiceId),
        ],
        [...sourceNotes, ...targetNotes],
        "阻碍进行声部配置不正确",
        `${chordLabel(sourceChord)} → ${chordLabel(targetChord)}：${problems.join("；")}。`,
        {
          chordIds: [sourceChord.id, targetChord.id],
          params: {
            bassResolves,
            leadingResolves,
            targetProfile,
          },
          evidence: [
            chordEvidence(sourceChord),
            chordEvidence(targetChord),
            ...(sourceBass ? [noteEvidence(sourceBass, "属和弦低音")] : []),
            ...(targetBass ? [noteEvidence(targetBass, "TSVI 低音")] : []),
            ...leadingSources.map(({ note }) => noteEvidence(note, "导音")),
          ],
          causeRefs: [
            `connection.deceptive-voice-leading|${connection.connectionKey}`,
          ],
          coverageRefs: [targetCause],
        },
      ),
    );
  });
  return diagnostics;
}

export const CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "resolution.augmented-sixth",
    catalogNumber: "E.5",
    label: "增六音程未反向解决",
    description: "跟踪增六两端的书写音高，要求低端下行半音、高端上行半音，形成目标属音的八度或进入已确认的 `K46` 过渡。",
    rationale: "Ger+6 为避免平行五度可能经过 `K46`；具体目标以功能标注为准。",
    group: "resolution",
    defaultSeverity: "error",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    augmentedSixthResolutionRule(analysis),
  }),
  defineStatelessRule({
    id: "connection.italian-augmented-sixth",
    catalogNumber: "H.9",
    label: "It+6 连接",
    description: "验证增六两端的反向半音解决，并检查第三个构成音的重复和目标和弦配置。",
    rationale: "E.5 作为通用父规则，在同一证据上由本条覆盖。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.augmented-sixth"
    ],
    evaluate: (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.italian-augmented-sixth",
    ),
  }),
  defineStatelessRule({
    id: "connection.french-augmented-sixth",
    catalogNumber: "H.10",
    label: "Fr+6 连接",
    description: "除增六两端外，检查其特有构成音在目标连接中的保持或级进，防止错误拼写造成假平行。",
    rationale: "必须按书写音程而非 pitch-class 集合识别。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.augmented-sixth"
    ],
    evaluate: (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.french-augmented-sixth",
    ),
  }),
  defineStatelessRule({
    id: "connection.german-augmented-sixth",
    catalogNumber: "H.11",
    label: "Ger+6 连接",
    description: "检查增六两端解决，并识别直接进入 D 可能形成的平行五度；优先验证经 `K46` 或教材允许的规避进行。",
    rationale: "真实平行五度仍由 C.2 报错，本条只解释该和弦特有的解决路径，不重复生成同一根因。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.augmented-sixth"
    ],
    evaluate: (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.german-augmented-sixth",
    ),
  }),
  defineStatelessRule({
    id: "function.deceptive-cadence-target",
    catalogNumber: "G.5",
    label: "阻碍进行目标",
    description: "仅在人工确认 `cadenceRole: deceptive` 时，验证后继功能、低音和倾向音处理是否符合阻碍进行 profile。",
    rationale: "普通 `D -> TSVI` 可以是非终止性连接；没有终止角色时不自动称为阻碍终止。",
    group: "function",
    defaultSeverity: "warning",
    requires: [
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: deceptiveCadenceTargetRule,
  }),
  defineStatelessRule({
    id: "connection.deceptive-voice-leading",
    catalogNumber: "H.12",
    label: "阻碍进行的声部配置",
    description: "在 G.5 确认阻碍语境后，验证低音进行、导音解决和目标 `TSVI` 的重复策略。",
    rationale: "大调、小调和不同 D 形态需要独立样本；本条覆盖通用倾向音诊断的同一证据。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "function.deceptive-cadence-target"
    ],
    evaluate: deceptiveVoiceLeadingRule,
  }),
);
