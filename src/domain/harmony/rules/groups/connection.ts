import { ALTERED_DOMINANT_FIFTH_RESOLUTION_RULE } from "./support/doubleDominant";
import {
  crossesManualPhraseBoundary,
  activeNotes,
  chordEvidence,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import { chordIdentityToneSpellings, identityContainsWrittenPitchClass } from "../../../chordModel";
import type { AnalysisSlice } from "../../analysis";
import { matchesWrittenChord } from "../../facts/tendencyResolution";
import { soundsCompleteWrittenChord } from "../../facts/writtenVoicing";
import type { RuleDiagnostic } from "../../runtime";
import { VOICE_ORDER } from "../../../project/voice";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  type KeyLike,
} from "../../../pitch";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import {
  isGermanToFrenchVoicing,
  isItalianToFrenchVoicing,
  isAuxiliaryAugmentedSixthReturn,
  resolvesPreparedDoubleAugmentedFourThree,
  resolvesAugmentedSixthHighToDominantSeventh,
} from "./support/augmentedSixth";
import { isMajorTonicSixFour, readWrittenDominantSeventh, resolvesDoubleAugmentedFourThree } from "../../facts/dominantMotion";

function continuesInFrenchVoicing(
  context: HarmonyRuleContext, link: ConnectionView, key: KeyLike,
) {
  const { sourceBoundary, targetBoundary } = link;
  const german = isGermanToFrenchVoicing(context, sourceBoundary, targetBoundary, key);
  if (!german && !isItalianToFrenchVoicing(context, sourceBoundary, targetBoundary, key)) return false;
  // Let the outgoing connection check the actual endpoint resolution.
  const next = context.spanNeighborhood(link.target).outgoing;
  if (!next?.connection.contiguous || !next.connection.sameKey || !next.targetBoundary.completeSatb ||
      next.sourceBoundary.endTick !== next.targetBoundary.tick) return false;
  if (german) return true;
  const frenchNotes = activeNotes(targetBoundary);
  return link.target.slices.every(slice => frenchNotes.every(({ voiceId, note }) =>
    slice.notes[voiceId]?.id === note.id,
  ));
}

function augmentedEndpoints(source: AnalysisSlice) {
  const chord = source.chord;
  if (chord?.identity.structure.kind !== "augmented-sixth") return;
  const tones = chordIdentityToneSpellings(chord.identity);
  const notes = activeNotes(source);
  const lows = notes.filter(({ note }) => pitchClassEquals(note.pitch, tones[0]));
  const highs = notes.filter(({ note }) => pitchClassEquals(note.pitch, tones.at(-1)!));
  if (lows.length === 1 && highs.length === 1) return { low: lows[0], high: highs[0] };
}

// Gaps have no HarmonySpan. Inspect just the two voices at the actual edge,
// leaving held endpoints and the function of the unlabelled sonority open.
function unlabelledAugmentedSixthResolutions(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const { previous: source, current: target, contiguous, sameKey } of context.sliceTransitions()) {
    const chord = source.chord;
    if (!contiguous || !sameKey || target.chord || chord?.identity.structure.kind !== "augmented-sixth" ||
        crossesManualPhraseBoundary(context, source.tick, target.tick)) continue;
    const ends = augmentedEndpoints(source);
    if (!ends) continue;
    const written = Object.values(source.notes);
    if (source.completeSatb ? !soundsCompleteWrittenChord(chord.identity, written, source.notes.bass!) :
        written.some(note => note.nonChordToneRole || !identityContainsWrittenPitchClass(chord.identity, note.pitch))) continue;
    const { low, high } = ends;
    const lowArrival = target.notes[low.voiceId], highArrival = target.notes[high.voiceId];
    if (!lowArrival || !highArrival || lowArrival.nonChordToneRole || highArrival.nonChordToneRole) continue;
    const reading = context.harmony.primaryInterpretation(chord);
    if (reading.status === "ambiguous") continue;
    const key = reading.status === "resolved" ? reading.value.localKey ?? source.key : source.key;
    const dominant = scaleDegreePitchClass(key, 5);
    const lowDelta = toMidi(lowArrival.pitch) - toMidi(low.note.pitch);
    const highDelta = toMidi(highArrival.pitch) - toMidi(high.note.pitch);
    const variant = chord.identity.structure.variant;
    const auxiliaryBass = ((variant === "french" && key.mode === "minor") ||
      (variant === "doubleAugmented43" && key.mode === "major")) && low.voiceId === "bass" &&
      (lowDelta === 4 || (key.mode === "minor" && lowDelta === -8)) && pitchClassEquals(lowArrival.pitch, key.tonic) &&
      (!target.completeSatb || matchesWrittenChord(target, key.tonic, key.mode));
    const targetSeventh = highDelta === -1 && readWrittenDominantSeventh(target.notes);
    const descendingSeventh = highDelta === -1 && pitchClassEquals(highArrival.pitch, scaleDegreePitchClass(key, 4)) &&
      (!target.completeSatb || (targetSeventh && pitchClassEquals(targetSeventh.root, dominant)));
    const wrongLow = !spelledPitchEquals(lowArrival.pitch, low.note.pitch) &&
      !(lowDelta === -1 && pitchClassEquals(lowArrival.pitch, dominant)) && !auxiliaryBass;
    const wrongHigh = !spelledPitchEquals(highArrival.pitch, high.note.pitch) &&
      !(highDelta === 1 && pitchClassEquals(highArrival.pitch, dominant)) && !descendingSeventh;
    if (!wrongLow && !wrongHigh) continue;
    const failed = [
      ...(wrongLow ? [{ ...low, arrival: lowArrival, label: "低端" }] : []),
      ...(wrongHigh ? [{ ...high, arrival: highArrival, label: "高端" }] : []),
    ];
    diagnostics.push(diagnostic("resolution.augmented-sixth", target.tick, target.endTick,
      failed.map(end => end.voiceId), failed.flatMap(end => [end.note, end.arrival]),
      "增六端点未按倾向解决", failed.map(end => "增六" + end.label + "移至不符合解决方向的实写音高").join("，") + "。",
      { chordIds: [chord.id], params: { lowDelta, highDelta },
        evidence: [chordEvidence(chord), ...[low, high].flatMap((end, i) => [
          noteEvidence(end.note, i ? "增六高端" : "增六低端"), noteEvidence(target.notes[end.voiceId]!, "后继音"),
        ])], causeRefs: ["resolution.augmented-sixth|" + chord.id + "|" + target.tick] }));
  }
  return diagnostics;
}

export function augmentedSixthResolutionRule(context: HarmonyRuleContext) {
  const diagnostics = unlabelledAugmentedSixthResolutions(context);
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
      sourceChord?.identity.structure.kind !== "augmented-sixth" ||
      !targetChord ||
      !sourceSlice.completeSatb ||
      !targetSlice.completeSatb
    )
      continue;

    const ends = augmentedEndpoints(sourceSlice);
    if (!ends) continue;
    const { low, high } = ends;
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
    const isDoubleAugmented43 = sourceChord.identity.structure.variant === "doubleAugmented43";
    const actualTargetKey = targetInterpretation?.localKey ?? targetSlice.key;
    const isDoubleAugmentedTarget = isDoubleAugmented43 &&
      targetResolution.status !== "ambiguous" &&
      sourceResolution.status !== "ambiguous" && keyEquals(actualTargetKey, sourceKey) &&
      isMajorTonicSixFour(targetChord.identity, sourceKey);
    if (isDoubleAugmentedTarget &&
        pitchClassEquals(sourceChord.identity.root, low.note.pitch) &&
        pitchClassEquals(sourceChord.identity.bass, sourceSlice.notes.bass!.pitch) &&
        !crossesManualPhraseBoundary(context, sourceSlice.tick, targetSlice.tick) &&
        (resolvesDoubleAugmentedFourThree(sourceSlice.notes, targetSlice.notes, sourceKey) ||
          resolvesPreparedDoubleAugmentedFourThree(context, candidate, sourceKey))) continue;
    if (!isDoubleAugmented43 && (isDominant || isCadential64) && lowResolves && highResolves)
      continue;
    const loweredSixth = scaleDegreePitchClass(sourceKey, 6, sourceKey.mode === "major" ? -1 : 0);
    if (!isDoubleAugmented43 && sourceResolution.status !== "ambiguous" && lowResolves &&
        pitchClassEquals(low.note.pitch, loweredSixth) &&
        !low.note.nonChordToneRole && !targetLow?.nonChordToneRole && targetHigh && highDelta === -1 &&
        resolvesAugmentedSixthHighToDominantSeventh(context, sourceSlice, targetSlice, sourceKey, high.note, targetHigh))
      continue;
    if (continuesInFrenchVoicing(context, candidate, sourceKey)) continue;
    if (!isDominant && !isCadential64 &&
        isAuxiliaryAugmentedSixthReturn(context, candidate, sourceKey)) continue;

    const problems = isDoubleAugmented43 ? ["重属倍增三四通常以实写升二级、升四级的上行半音及降六级的下行半音解决到大调主四六，辅助性回归需核对前后主和弦及实际声部"] : [
      ...(!isDominant && !isCadential64 ? ["目标不是明确的属功能或 K46"] : []),
      ...(!lowResolves ? ["增六低端未下行半音到属音"] : []),
      ...(!highResolves ? ["增六高端未上行半音到属音"] : []),
    ];
    const sourceAllNotes = activeNotes(sourceSlice).map(({ note }) => note);
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
      "检查增六和弦是否反向半音解决到属音，或形成句末增六和弦向同一原位主和弦的辅助性回归。",
    rationale:
      "增六和弦通常由降Ⅵ级下行、升Ⅳ级上行半音汇聚于属音。斯波索宾第30章亦允许经辅助性增六返回主和弦作为补充终止，此时须由前后主和弦与实际声部进行共同确认。",
    group: "resolution",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: augmentedSixthResolutionRule,
  }),
  ALTERED_DOMINANT_FIFTH_RESOLUTION_RULE,
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
