import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import type { RuleConfig } from "../../runtime";
import { chordIdentityToneSpellings } from "../../../chordModel";
import { VOICE_ORDER } from "../../../project/voice";
import { durationToTicksAt } from "../../../time";
import {
  keyEquals,
  formatSpelledPitch,
  pitchClassEquals,
  scaleDegreePitchClass,
  stepIndex,
} from "../../../pitch";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineStatelessRule } from "../defineRule";
import { diagnostic, hasExactPitch, noteEvidence, voiceName } from "../helpers/core";
import { bassNeighborAgainstHeldUpper } from "../helpers/ornaments";
import { soundsDeclaredChord } from "../../facts/writtenVoicing";
import { leadingToneForFunction } from "../services/harmony";

function chromaticHarmonyLicenses(
  context: HarmonyRuleContext,
  note: AnalysisNote,
  slice: AnalysisSlice | undefined,
) {
  const chord = slice?.chord;
  if (
    !chord ||
    !hasExactPitch(note, chordIdentityToneSpellings(chord.identity))
  )
    return false;
  const resolution = context.harmony.primaryInterpretation(chord);
  const interpretation =
    resolution.status === "resolved" ? resolution.value : undefined;
  const kind = interpretation?.designation?.kind;
  return (
    chord.identity.structure.kind === "augmented-sixth" ||
    (chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.alterations.length > 0) ||
    Boolean(chord.semantics?.mixture) ||
    Boolean(interpretation?.appliedTarget) ||
    kind === "applied-dominant" ||
    kind === "applied-leading-tone" ||
    kind === "double-dominant" ||
    kind === "double-dominant-leading-tone" ||
    kind === "neapolitan" ||
    kind === "augmented-sixth"
  );
}

interface CrossRelationCandidate {
  left: { voiceId: (typeof VOICE_ORDER)[number]; note: AnalysisNote };
  right: { voiceId: (typeof VOICE_ORDER)[number]; note: AnalysisNote };
  simultaneous: boolean;
  tick: number;
  endTick: number;
  windowTicks: number;
  connectionKey?: string;
}

// §§28.4, 32.4: a correctly spelled applied leading tone still needs
// same-voice preparation when the previous chord sounds its natural form.
function transferredLeadingToneConnection(
  context: HarmonyRuleContext,
  left: CrossRelationCandidate["left"],
  right: CrossRelationCandidate["right"],
  arrival: AnalysisSlice | undefined,
): string | undefined {
  const tick = right.note.startTick;
  if (
    left.note.startTick + left.note.durationTicks !== tick ||
    right.note.pitch.alter !== left.note.pitch.alter + 1 ||
    !arrival?.chord || arrival.chord.startTick !== tick
  ) return;

  const before = context.sliceAt(tick - 1);
  if (
    !before?.chord ||
    before.notes[left.voiceId]?.id !== left.note.id ||
    context.analysis.phraseBoundaries.some(boundary => !boundary.stale && boundary.tick === tick)
  ) return;

  const sourceReading = context.harmony.primaryInterpretation(before.chord);
  const targetReading = context.harmony.primaryInterpretation(arrival.chord);
  if (sourceReading.status !== "resolved" || targetReading.status !== "resolved") return;

  const key = targetReading.value.localKey ?? arrival.key;
  const sourceKey = sourceReading.value.localKey ?? before.key;
  const leading = leadingToneForFunction(key, targetReading.value);
  if (
    !keyEquals(key, sourceKey) ||
    !leading.applied || !pitchClassEquals(leading.tone, right.note.pitch)
  ) return;

  const { identity } = arrival.chord;
  if (identity.structure.kind !== "tertian") return;

  const tones = chordIdentityToneSpellings(identity);
  const { quality } = identity.structure;
  const leadingMember = quality === "major" || quality === "dominant7" ? tones[1]
    : quality === "diminished" || quality === "diminished7" || quality === "halfDiminished7" ? tones[0]
    : undefined;
  if (!leadingMember || !pitchClassEquals(leadingMember, right.note.pitch)) return;

  const preparation = chordIdentityToneSpellings(before.chord.identity);
  if (!preparation.every(tone => {
    const degree = (stepIndex(tone.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
    return pitchClassEquals(tone, scaleDegreePitchClass(key, degree));
  })) return;

  // A doubled degree can rise in its own voice while the other copy leaves.
  if (VOICE_ORDER.some(voiceId => {
    const previous = before.notes[voiceId];
    const current = arrival.notes[voiceId];
    return previous && current &&
      pitchClassEquals(previous.pitch, left.note.pitch) &&
      pitchClassEquals(current.pitch, right.note.pitch);
  })) return;

  if (!soundsDeclaredChord(before) || !soundsDeclaredChord(arrival)) return;

  // Limit the modulation exception to the connection that produced this pair.
  const sourceSpanId = context.spanAt(tick - 1)?.span.id;
  const targetSpanId = context.spanAt(tick)?.span.id;
  if (sourceSpanId && targetSpanId)
    return context.connections({ sourceSpanId, targetSpanId }).first()?.connection.connectionKey;
}

function crossRelationCandidates(
  context: HarmonyRuleContext,
  config: RuleConfig,
) {
  const { analysis } = context;
  const configuredWindow = config.window;
  const duration =
    configuredWindow &&
    typeof configuredWindow === "object" &&
    "value" in configuredWindow &&
    "unit" in configuredWindow
      ? configuredWindow
      : { value: 1, unit: "beats" as const };
  const notes = context
    .notes()
    .orderBy(({ note, voiceId }) => `${String(note.startTick).padStart(12, "0")}:${voiceId}`)
    .toArray();
  const candidates: CrossRelationCandidate[] = [];

  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    const left = notes[leftIndex];
    const leftEnd = left.note.startTick + left.note.durationTicks;
    const windowTicks = durationToTicksAt(analysis.project, leftEnd, duration);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < notes.length;
      rightIndex += 1
    ) {
      const right = notes[rightIndex];
      if (right.note.startTick - leftEnd > windowTicks) break;
      if (left.voiceId === right.voiceId) continue;
      if (
        left.note.pitch.step !== right.note.pitch.step ||
        left.note.pitch.alter === right.note.pitch.alter
      )
        continue;
      const rightEnd = right.note.startTick + right.note.durationTicks;
      const overlapStart = Math.max(left.note.startTick, right.note.startTick);
      const overlapEnd = Math.min(leftEnd, rightEnd);
      const simultaneous = overlapStart < overlapEnd;
      const gap = simultaneous ? 0 : right.note.startTick - leftEnd;
      if (!simultaneous && (gap < 0 || gap > windowTicks)) continue;
      const leftKey = context.keyAt(left.note.startTick);
      const rightKey = context.keyAt(right.note.startTick);
      if (!leftKey || !rightKey) continue;
      if (
        !keyEquals(leftKey, rightKey)
      )
        continue;
      const leftSlice = context.sliceAt(left.note.startTick);
      const rightSlice = context.sliceAt(right.note.startTick);
      let connectionKey: string | undefined;
      if (
        !simultaneous &&
        (chromaticHarmonyLicenses(context, left.note, leftSlice) ||
          chromaticHarmonyLicenses(context, right.note, rightSlice))
      ) {
        connectionKey = transferredLeadingToneConnection(context, left, right, rightSlice);
        if (!connectionKey) continue;
      }
      candidates.push({
        left,
        right,
        simultaneous,
        tick: simultaneous ? overlapStart : right.note.startTick,
        endTick: simultaneous ? overlapEnd : rightEnd,
        windowTicks,
        connectionKey,
      });
    }
  }
  return candidates;
}

function crossRelationDiagnostic(
  context: HarmonyRuleContext,
  candidate: CrossRelationCandidate,
  ruleId:
    | "voice-leading.cross-relation-simultaneous"
    | "voice-leading.cross-relation-successive",
  kind: "simultaneous" | "successive",
  title: string,
  confidence: number,
) {
  return diagnostic(
    ruleId,
    candidate.tick,
    candidate.endTick,
    [candidate.left.voiceId, candidate.right.voiceId],
    [candidate.left.note, candidate.right.note],
    title,
    `${voiceName(context.analysis, candidate.left.voiceId)}的 ${formatSpelledPitch(candidate.left.note.pitch)} 与${voiceName(context.analysis, candidate.right.voiceId)}的 ${formatSpelledPitch(candidate.right.note.pitch)} 使用同一字母音名但不同升降号。`,
    {
      messageKey: `${ruleId}.${kind}`,
      params: { kind, windowTicks: candidate.windowTicks },
      causeRefs: candidate.connectionKey ? [`${ruleId}|${candidate.connectionKey}`] : undefined,
      evidence: [
        noteEvidence(
          candidate.left.note,
          voiceName(context.analysis, candidate.left.voiceId),
        ),
        noteEvidence(
          candidate.right.note,
          voiceName(context.analysis, candidate.right.voiceId),
        ),
      ],
      confidence,
    },
  );
}

export function simultaneousCrossRelationRule(context: HarmonyRuleContext) {
  return crossRelationCandidates(context, {})
    .filter(({ simultaneous, left, right }) => simultaneous &&
      !(right.voiceId === "bass" && bassNeighborAgainstHeldUpper(context, right.note, left.voiceId, left.note)))
    .map((candidate) =>
      crossRelationDiagnostic(
        context,
        candidate,
        "voice-leading.cross-relation-simultaneous",
        "simultaneous",
        "同时对斜",
        1,
      ),
    );
}

export function successiveCrossRelationRule(
  context: HarmonyRuleContext,
  config: RuleConfig,
) {
  return crossRelationCandidates(context, config)
    .filter((candidate) => !candidate.simultaneous)
    .map((candidate) =>
      crossRelationDiagnostic(
        context,
        candidate,
        "voice-leading.cross-relation-successive",
        "successive",
        "先后对斜",
        0.9,
      ),
    );
}

export const SIMULTANEOUS_CROSS_RELATION_RULE = defineStatelessRule({
  id: "voice-leading.cross-relation-simultaneous",
  catalogNumber: "C.7",
  label: "同时对斜",
  description:
    "检查同一瞬间不同声部中是否同时出现了同一音级的本位音与变化音。",
  rationale:
    "同一音级的两个变化形态（如 C 与 #C）在纵向上同时发响，会产生极其尖锐突兀的半音撞音（增一度/减八度不协和冲突），造成调式调性听觉严重混乱。",
  group: "voiceLeading",
  defaultSeverity: "warning",
  requires: ["written-pitches"],
  dependencyScope: "slice",
  supportedExceptionContexts: ["modulation", "ambiguous-semantics"],
  defaultExceptionPolicies: {
    modulation: "exempt",
    "ambiguous-semantics": "exempt",
  },
  evaluate: simultaneousCrossRelationRule,
});

export const SUCCESSIVE_CROSS_RELATION_RULE = defineStatelessRule({
  id: "voice-leading.cross-relation-successive",
  catalogNumber: "C.8",
  label: "先后对斜",
  description:
    "检查一个声部刚唱完某音级后，另一声部紧接着出现该音级的变化形态。",
  rationale:
    "调式变化音（如半音化升降）应当由产生该音的同一声部直接进行半音级进完成（半音进行原则）。如果将变化音交由另一个声部发出，前一声部的音高记忆尚未消退便产生冲突，形成“先后对斜（Cross-relation）”。",
  group: "voiceLeading",
  defaultSeverity: "suggestion",
  requires: ["written-pitches"],
  dependencyScope: "slice",
  options: [
    {
      kind: "duration",
      key: "window",
      label: "先后对斜窗口",
      description: "两个起奏之间允许关联为先后对斜的最长音乐时值。",
      section: "threshold",
      required: true,
      defaultValue: {
        value: 1,
        unit: "beats",
      },
      min: 0.25,
      max: 8,
      step: 0.25,
    },
  ],
  supportedExceptionContexts: ["modulation", "ambiguous-semantics"],
  defaultExceptionPolicies: {
    modulation: "exempt",
    "ambiguous-semantics": "exempt",
  },
  evaluate: successiveCrossRelationRule,
});
