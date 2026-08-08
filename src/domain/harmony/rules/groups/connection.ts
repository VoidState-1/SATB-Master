import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type { AnalysisNote, HarmonyAnalysis } from "../../../harmonyAnalysis";
import type { RuleDiagnostic } from "../../../harmonyRuntime";
import { VOICE_ORDER } from "../../../model";
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
    if (!sourceChord) return;
    const resolves = Boolean(
      sourceIsDominant &&
        connection?.relation === "deceptive" &&
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
          exceptionContexts: connection
            ? [...connection.exceptionTags]
            : ["insufficient-context"],
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
        },
      ),
    );
  });
  return diagnostics;
}
