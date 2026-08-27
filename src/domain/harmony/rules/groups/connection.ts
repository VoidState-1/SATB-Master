import {
  chordIdentityToneSpellings,
} from "../../../chordModel";
import type { AnalysisNote } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { VOICE_ORDER } from "../../../project/voice";
import {
  leadingTonePitchClass,
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
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

interface AugmentedSixthResolutionPolicy {
  id:
    | "resolution.augmented-sixth"
    | "connection.italian-augmented-sixth"
    | "connection.french-augmented-sixth"
    | "connection.german-augmented-sixth";
  expectedVariant?: "italian" | "french" | "german";
  checkCharacteristicTone: boolean;
  generic: boolean;
}

function evaluateAugmentedSixthResolution(
  context: HarmonyRuleContext,
  policy: AugmentedSixthResolutionPolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const source of context.spans()) {
    const sourceSpan = source.span;
    const sourceSpanChord = source.firstSlice.chord;
    if (sourceSpanChord?.identity.structure.kind !== "augmented-sixth")
      continue;
    if (
      policy.expectedVariant &&
      sourceSpanChord.identity.structure.variant !== policy.expectedVariant
    )
      continue;
    const candidate = context.connections({ sourceSpanId: sourceSpan.id }).first();
    if (!candidate) continue;
    const { connection } = candidate;
    if (!connection.contiguous || !connection.sameKey) continue;
    const targetSpan = candidate.target.span;
    const sourceSlice = candidate.sourceBoundary;
    const targetSlice = candidate.targetBoundary;
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
    if (policy.checkCharacteristicTone) {
      const candidates = sourceNotes.filter(({ note }) =>
        pitchClassEquals(note.pitch, tones[2]),
      );
      characteristicSource =
        candidates.length === 1 ? candidates[0].note : undefined;
      characteristicTarget =
        candidates.length === 1
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
      continue;

    const problems = [
      ...(!isDominant && !isCadential64 ? ["目标不是明确的属功能或 K46"] : []),
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
    const genericCause = `resolution.augmented-sixth|${connection.connectionKey}`;
    const specificCause = `${policy.id}|${connection.connectionKey}`;
    diagnostics.push(
      diagnostic(
        policy.id,
        targetSlice.tick,
        targetSlice.endTick,
        [...VOICE_ORDER],
        [...sourceAllNotes, ...targetAllNotes],
        policy.generic
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
          coverageRefs: policy.generic ? undefined : [genericCause],
        },
      ),
    );
  }
  return diagnostics;
}

export function augmentedSixthResolutionRule(context: HarmonyRuleContext) {
  return evaluateAugmentedSixthResolution(context, {
    id: "resolution.augmented-sixth",
    checkCharacteristicTone: false,
    generic: true,
  });
}

export function italianAugmentedSixthConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateAugmentedSixthResolution(context, {
    id: "connection.italian-augmented-sixth",
    expectedVariant: "italian",
    checkCharacteristicTone: false,
    generic: false,
  });
}

export function frenchAugmentedSixthConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateAugmentedSixthResolution(context, {
    id: "connection.french-augmented-sixth",
    expectedVariant: "french",
    checkCharacteristicTone: true,
    generic: false,
  });
}

export function germanAugmentedSixthConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateAugmentedSixthResolution(context, {
    id: "connection.german-augmented-sixth",
    expectedVariant: "german",
    checkCharacteristicTone: false,
    generic: false,
  });
}

export function deceptiveCadenceTargetRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const { analysis } = context;
  for (const source of context.spans()) {
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
    const candidate = context.connections({ sourceSpanId: sourceSpan.id }).first();
    const connection = candidate?.connection;
    const sourceChord = source.lastSlice.chord;
    const targetChord = candidate?.target.firstSlice.chord;
    if (
      !sourceChord ||
      !connection ||
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

export function deceptiveVoiceLeadingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const source of context.spans()) {
    const sourceSpan = source.span;
    if (sourceSpan.semantics?.cadenceRole !== "deceptive") continue;
    const candidate = context.connections({ sourceSpanId: sourceSpan.id }).first();
    const connection = candidate?.connection;
    if (
      connection?.relation !== "deceptive" ||
      !connection.contiguous ||
      !connection.sameKey
    )
      continue;
    if (!candidate) continue;
    const sourceSlice = candidate.sourceBoundary;
    const targetSlice = candidate.targetBoundary;
    const sourceChord = sourceSlice.chord;
    const targetChord = targetSlice.chord;
    if (
      !sourceChord ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      continue;

    const sourceBass = sourceSlice.notes.bass;
    const targetBass = targetSlice.notes.bass;
    const dominant = scaleDegreePitchClass(sourceSlice.key, 5, 0);
    const submediant = scaleDegreePitchClass(sourceSlice.key, 6, 0);
    const tonic = sourceSlice.key.tonic;
    const leadingTone = leadingTonePitchClass(sourceSlice.key);
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
    if (bassResolves && leadingResolves && targetProfile) continue;

    const problems = [
      ...(!bassResolves ? ["低音未按 5→6 进行"] : []),
      ...(!leadingResolves ? ["导音未按 7→1 上行解决"] : []),
      ...(!targetProfile ? ["TSVI 未采用三音重复配置"] : []),
    ];
    const sourceNotes = activeNotes(sourceSlice).map(({ note }) => note);
    const targetNotes = activeNotes(targetSlice).map(({ note }) => note);
    const targetCause = `function.deceptive-cadence-target|${connection.connectionKey}`;
    diagnostics.push(
      diagnostic(
        "connection.deceptive-voice-leading",
        targetSlice.tick,
        targetSlice.endTick,
        ["bass", ...leadingSources.map(({ voiceId }) => voiceId)],
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
  }
  return diagnostics;
}

export const CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "resolution.augmented-sixth",
    catalogNumber: "E.5",
    label: "增六音程未反向解决",
    description:
      "检查增六和弦中的特征增六度音程是否两端反向半音级进扩张解决到纯八度。",
    rationale:
      "增六和弦由降Ⅵ级低音与升Ⅳ级高音构成增六度。根据增音程向外扩张的声学与调式倾向，降Ⅵ级必须向下半音进行至属音（Ⅴ级），升Ⅳ级必须向上半音进行至属音（Ⅴ级），两者反向展开并在外声部汇聚于纯八度属音上。",
    group: "resolution",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: augmentedSixthResolutionRule,
  }),
  defineStatelessRule({
    id: "connection.italian-augmented-sixth",
    catalogNumber: "H.9",
    label: "It+6 连接",
    description:
      "检查意大利增六和弦（降6、1、升4）的增六度两端解决与主音重复配置。",
    rationale:
      "意大利增六和弦仅有三个不同音级（b6, 1, #4），在四部和声中必须重复调式主音（1级音）。解决时，增六两端反向进入属音八度，一个主音保持为属和弦的五音，另一个主音下行级进进入属和弦的三音（导音）。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["resolution.augmented-sixth"],
    evaluate: italianAugmentedSixthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.french-augmented-sixth",
    catalogNumber: "H.10",
    label: "Fr+6 连接",
    description:
      "检查法国增六和弦（降6、1、2、升4）进入属和弦时的特有声部进行。",
    rationale:
      "法国增六和弦包含调式第二级音（2级音）。解决进入属和弦时，增六两端（b6 与 #4）反向解决至属音八度，主音（1级音）下行级进至导音，2级音则作为共同音直接保持在同一声部中成为属和弦的五音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["resolution.augmented-sixth"],
    evaluate: frenchAugmentedSixthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.german-augmented-sixth",
    catalogNumber: "H.11",
    label: "Ger+6 连接",
    description:
      "检查德国增六和弦（降6、1、降3、升4）在解决至属和弦时是否经由 K46 规避平行五度。",
    rationale:
      "德国增六和弦包含降3级音（小调降三音）。若直接解决到原位属和弦，低音（b6）与内声部（b3）同时下行半音至属和弦的低音（5）与五音（2），必然产生平行的“莫扎特五度”。古典传统标准做法是先解决到终止四六（K46），消除平行五度后再进入属和弦。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["resolution.augmented-sixth"],
    evaluate: germanAugmentedSixthConnectionRule,
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
  defineStatelessRule({
    id: "connection.deceptive-voice-leading",
    catalogNumber: "H.12",
    label: "阻碍进行的声部配置",
    description:
      "检查 Ⅴ-Ⅵ 阻碍进行中低音是否二度上行、导音是否上行解决且 Ⅵ 级和弦是否重复三音。",
    rationale:
      "在 Ⅴ 到 Ⅵ 的阻碍进行中，低音由 5 级上行二度至 6 级，导音（7 级）必须严格上行半音解决至主音（1 级）。为避免平行五八度并顺应声部进行，目标 Ⅵ 级三和弦必须重复其三音（即调式主音 1 级），而非重复根音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["function.deceptive-cadence-target"],
    evaluate: deceptiveVoiceLeadingRule,
  }),
);
