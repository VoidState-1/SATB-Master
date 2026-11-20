import { chordIdentityToneSpellings } from "../../../chordModel";
import type { RuleDiagnostic } from "../../runtime";
import { VOICE_ORDER } from "../../../project/voice";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  type KeyLike,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import { isGermanToFrenchVoicing } from "./augmentedSixthContinuation";
import { isAuxiliaryFrenchSixthReturn } from "./auxiliaryAugmentedSixth";
import { isMajorTonicSixFour, resolvesDoubleAugmentedFourThree } from "../../doubleAugmentedFourThree";
import { resolvesPreparedDoubleAugmentedFourThree } from "./preparedDoubleAugmentedFourThree";

function isGermanToFrenchContinuation(
  context: HarmonyRuleContext, link: ConnectionView, key: KeyLike,
) {
  if (!isGermanToFrenchVoicing(context, link.sourceBoundary, link.targetBoundary, key)) return false;
  // Let the outgoing connection check the actual endpoint resolution.
  const next = context.spanNeighborhood(link.target).outgoing;
  return !!next?.connection.contiguous && next.connection.sameKey && next.targetBoundary.completeSatb &&
    next.sourceBoundary.endTick === next.targetBoundary.tick;
}

export function augmentedSixthResolutionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const candidate of context.connections()) {
    const { connection, source, target, sourceBoundary: sourceSlice, targetBoundary: targetSlice } =
      candidate;
    if (!connection.contiguous || !connection.sameKey) continue;
    const sourceSpanChord = source.firstSlice.chord;
    if (sourceSpanChord?.identity.structure.kind !== "augmented-sixth")
      continue;
    const targetSpan = target.span;
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      continue;

    const tones = chordIdentityToneSpellings(sourceChord.identity);
    const sourceNotes = activeNotes(sourceSlice);
    const lowCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones[0]),
    );
    const highCandidates = sourceNotes.filter(({ note }) =>
      pitchClassEquals(note.pitch, tones.at(-1)!),
    );
    // 两端音缺失或重复属于 D.13 的静态配置错误；本规则只在端点唯一时检查横向解决。
    if (lowCandidates.length !== 1 || highCandidates.length !== 1) continue;
    const low = lowCandidates[0];
    const high = highCandidates[0];
    const targetLow = targetSlice.notes[low.voiceId];
    const targetHigh = targetSlice.notes[high.voiceId];
    const targetResolution = context.harmony.primaryInterpretation(targetSpan);
    const targetInterpretation =
      targetResolution.status === "resolved"
        ? targetResolution.value
        : undefined;
    const targetKind = targetInterpretation?.designation?.kind;
    const isCadential64 =
      targetKind === "cadential64" ||
      targetSpan.semantics?.cadenceRole === "cadential64";
    const isDominant =
      targetInterpretation?.designation?.primaryFunction === "dominant" ||
      targetInterpretation?.degree === 5 ||
      targetInterpretation?.degree === 7;
    const sourceResolution = context.harmony.primaryInterpretation(sourceChord);
    const sourceKey = sourceResolution.status === "resolved"
      ? sourceResolution.value.localKey ?? sourceSlice.key
      : sourceSlice.key;
    const dominantPitch = scaleDegreePitchClass(sourceKey, 5, 0);
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
    const isDoubleAugmented43 = sourceChord.identity.structure.kind === "augmented-sixth" &&
      sourceChord.identity.structure.variant === "doubleAugmented43";
    const actualTargetKey = targetInterpretation?.localKey ?? targetSlice.key;
    const isDoubleAugmentedTarget = isDoubleAugmented43 &&
      targetResolution.status !== "ambiguous" &&
      sourceResolution.status !== "ambiguous" && actualTargetKey.mode === sourceKey.mode &&
      pitchClassEquals(actualTargetKey.tonic, sourceKey.tonic) &&
      isMajorTonicSixFour(targetChord.identity, sourceKey);
    if (isDoubleAugmentedTarget &&
        pitchClassEquals(sourceChord.identity.root, low.note.pitch) &&
        pitchClassEquals(sourceChord.identity.bass, sourceSlice.notes.bass!.pitch) &&
        !context.analysis.phraseBoundaries.some(mark =>
          mark.source === "manual" && sourceSlice.tick < mark.tick && mark.tick <= targetSlice.tick) &&
        (resolvesDoubleAugmentedFourThree(sourceSlice.notes, targetSlice.notes, sourceKey) ||
          resolvesPreparedDoubleAugmentedFourThree(context, candidate, sourceKey))) continue;
    if (!isDoubleAugmented43 && (isDominant || isCadential64) && lowResolves && highResolves)
      continue;
    if (isGermanToFrenchContinuation(context, candidate, sourceKey)) continue;
    if (!isDominant && !isCadential64 &&
        isAuxiliaryFrenchSixthReturn(context, candidate, sourceKey)) continue;

    const problems = isDoubleAugmented43 ? ["重属倍增三四须以实写升二级、升四级的上行半音及降六级的下行半音解决到大调主四六"] : [
      ...(!isDominant && !isCadential64 ? ["目标不是明确的属功能或 K46"] : []),
      ...(!lowResolves ? ["增六低端未下行半音到属音"] : []),
      ...(!highResolves ? ["增六高端未上行半音到属音"] : []),
    ];
    const sourceAllNotes = sourceNotes.map(({ note }) => note);
    const targetAllNotes = activeNotes(targetSlice).map(({ note }) => note);
    const specificCause = `resolution.augmented-sixth|${connection.connectionKey}`;
    diagnostics.push(
      diagnostic(
        "resolution.augmented-sixth",
        targetSlice.tick,
        targetSlice.endTick,
        [...VOICE_ORDER],
        [...sourceAllNotes, ...targetAllNotes],
        "增六音程未按反向半音解决",
        `${chordLabel(sourceChord)}：${problems.join("；")}。`,
        {
          chordIds: [sourceChord.id, targetChord.id],
          params: {
          target: isCadential64 || isDoubleAugmentedTarget ? "K46" : isDominant ? "D" : "other",
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
          ],
          causeRefs: [specificCause],
        },
      ),
    );
  }
  return diagnostics;
}

export function deceptiveCadenceTargetRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const { analysis } = context;
  for (const candidate of context.connections()) {
    const {
      connection,
      source,
      target,
    } = candidate;
    const sourceSpan = source.span;
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") continue;
    const sourceResolution = context.harmony.primaryInterpretation(sourceSpan);
    const sourceInterpretation =
      sourceResolution.status === "resolved"
        ? sourceResolution.value
        : undefined;
    const sourceIsDominant =
      sourceInterpretation?.designation?.primaryFunction === "dominant" ||
      sourceInterpretation?.degree === 5 ||
      sourceInterpretation?.degree === 7;
    const sourceChord = source.lastSlice.chord;
    const targetChord = target.firstSlice.chord;
    if (
      !sourceChord ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      continue;
    const resolves = Boolean(
      sourceIsDominant &&
      connection.relation === "deceptive" &&
      connection.contiguous &&
      connection.sameKey,
    );
    if (resolves) continue;
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
  }
  return diagnostics;
}

export const CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "resolution.augmented-sixth",
    catalogNumber: "E.5",
    label: "增六音程未反向解决",
    description:
      "检查增六和弦是否反向半音解决到属音，或形成句末法增六向原位小主和弦的辅助性回归。",
    rationale:
      "增六和弦通常由降Ⅵ级下行、升Ⅳ级上行半音汇聚于属音。斯波索宾第30章亦允许经辅助性增六返回主和弦作为补充终止，此时须由前后主和弦与实际声部进行共同确认。",
    group: "resolution",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: augmentedSixthResolutionRule,
  }),
  defineStatelessRule({
    id: "function.deceptive-cadence-target",
    catalogNumber: "G.5",
    label: "阻碍进行目标",
    description:
      "检查属功能和弦（D）在阻碍进行中是否正确导向了下属-主功能和弦（TSVI）。",
    rationale:
      "阻碍进行（Deceptive Progression）打破了听众对属到主（D → T）完满解决的心理期待，将属和弦导向Ⅵ级和弦（TSVI）。它推迟了终止感的到来，极大地拓展了音乐的发展空间。",
    group: "function",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: deceptiveCadenceTargetRule,
  }),
);
