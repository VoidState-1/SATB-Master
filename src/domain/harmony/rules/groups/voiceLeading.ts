import {
  analysisKeyAtTick,
  type AnalysisNote,
  type AnalysisSlice,
} from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import {
  chordIdentityToneSpellings,
} from "../../../chordModel";
import { VOICE_ORDER } from "../../../project/voice";
import { durationToTicksAt } from "../../../time";
import { formatSpelledPitch, pitchClassEquals, toMidi } from "../../../pitch";
import {
  type VoicePairTransitionFact,
} from "../sharedFacts";
import {
  diagnostic,
  hasExactPitch,
  isDiminishedFifth,
  isPerfectFifth,
  noteEvidence,
  pitchClass,
  voiceName,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

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
      const leftKey = analysisKeyAtTick(analysis, left.note.startTick);
      const rightKey = analysisKeyAtTick(analysis, right.note.startTick);
      if (
        leftKey.mode !== rightKey.mode ||
        !pitchClassEquals(leftKey.tonic, rightKey.tonic)
      )
        continue;
      const leftSlice = context.sliceAt(left.note.startTick);
      const rightSlice = context.sliceAt(right.note.startTick);
      if (
        !simultaneous &&
        (chromaticHarmonyLicenses(context, left.note, leftSlice) ||
          chromaticHarmonyLicenses(context, right.note, rightSlice))
      )
        continue;
      candidates.push({
        left,
        right,
        simultaneous,
        tick: simultaneous ? overlapStart : right.note.startTick,
        endTick: simultaneous ? overlapEnd : rightEnd,
        windowTicks,
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
    .filter((candidate) => candidate.simultaneous)
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

type VoicePairRuleId =
  | "voice-leading.parallel-fifths"
  | "voice-leading.parallel-octaves"
  | "voice-leading.hidden-fifth"
  | "voice-leading.hidden-octave"
  | "voice-leading.overlap"
  | "voice-leading.unequal-fifths-perfect-to-diminished"
  | "voice-leading.unequal-fifths-outer-diminished-to-perfect"
  | "voice-leading.unequal-fifths-inner-diminished-to-perfect";

interface VoicePairRulePolicy {
  id: VoicePairRuleId;
  title: string;
  message: string;
  matches(fact: VoicePairTransitionFact): boolean;
}

function isPerfectOctave(interval: VoicePairTransitionFact["currentInterval"]) {
  return (
    Math.abs(interval.diatonicSteps) % 7 === 0 &&
    pitchClass(interval.semitones) === 0
  );
}

function evaluateVoicePairRule(
  context: HarmonyRuleContext,
  policy: VoicePairRulePolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const transition of context.sliceTransitions()) {
    for (const fact of context.voiceLeading.voicePairs(transition)) {
      if (!policy.matches(fact)) continue;
      const [upperId, lowerId] = fact.voiceIds;
      const [previousUpper, previousLower] = fact.previousNotes;
      const [currentUpper, currentLower] = fact.currentNotes;
      diagnostics.push(
        diagnostic(
          policy.id,
          transition.current.tick,
          transition.current.endTick,
          [upperId, lowerId],
          [previousUpper, previousLower, currentUpper, currentLower],
          policy.title,
          policy.message,
          {
            causeRefs: [
              `${policy.id}|${transition.id}|voices:${upperId},${lowerId}`,
            ],
            evidence: [
              noteEvidence(
                previousUpper,
                `${voiceName(context.analysis, upperId)}前一音`,
              ),
              noteEvidence(
                previousLower,
                `${voiceName(context.analysis, lowerId)}前一音`,
              ),
              noteEvidence(
                currentUpper,
                `${voiceName(context.analysis, upperId)}当前音`,
              ),
              noteEvidence(
                currentLower,
                `${voiceName(context.analysis, lowerId)}当前音`,
              ),
            ],
          },
        ),
      );
    }
  }
  return diagnostics;
}

export function parallelFifthsRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.parallel-fifths",
    title: "平行纯五度",
    message: "两个声部同向移动，并连续形成相同类型的完全协和音程。",
    matches: (fact) =>
      fact.sameDirection &&
      isPerfectFifth(fact.previousInterval) &&
      isPerfectFifth(fact.currentInterval),
  });
}

export function parallelOctavesRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.parallel-octaves",
    title: "平行八度或同度",
    message: "两个声部同向移动，并连续形成相同类型的完全协和音程。",
    matches: (fact) =>
      fact.sameDirection &&
      isPerfectOctave(fact.previousInterval) &&
      isPerfectOctave(fact.currentInterval),
  });
}

export function hiddenFifthRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.hidden-fifth",
    title: "外声部隐伏五度",
    message: "外声部同向进入纯五度，且高声部发生跳进。",
    matches: (fact) =>
      fact.outerVoicesOnly &&
      fact.sameDirection &&
      isPerfectFifth(fact.currentInterval) &&
      !isPerfectFifth(fact.previousInterval) &&
      Math.abs(
        toMidi(fact.currentNotes[0].pitch) -
          toMidi(fact.previousNotes[0].pitch),
      ) > 2,
  });
}

export function hiddenOctaveRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.hidden-octave",
    title: "外声部隐伏八度",
    message: "外声部同向进入八度或同度，且高声部发生跳进。",
    matches: (fact) =>
      fact.outerVoicesOnly &&
      fact.sameDirection &&
      isPerfectOctave(fact.currentInterval) &&
      !isPerfectOctave(fact.previousInterval) &&
      Math.abs(
        toMidi(fact.currentNotes[0].pitch) -
          toMidi(fact.previousNotes[0].pitch),
      ) > 2,
  });
}

export function voiceOverlapRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.overlap",
    title: "声部重叠",
    message: "当前声部进入了相邻声部上一位置所占据的音域。",
    matches: (fact) => {
      const [upperId, lowerId] = fact.voiceIds;
      const adjacent =
        VOICE_ORDER.indexOf(lowerId) === VOICE_ORDER.indexOf(upperId) + 1;
      return (
        adjacent &&
        (toMidi(fact.currentNotes[0].pitch) <
          toMidi(fact.previousNotes[1].pitch) ||
          toMidi(fact.currentNotes[1].pitch) >
            toMidi(fact.previousNotes[0].pitch))
      );
    },
  });
}

export function perfectToDiminishedFifthRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.unequal-fifths-perfect-to-diminished",
    title: "纯五度到减五度",
    message:
      "前一切片为纯五度，后一切片为减五度；该进行按默认 profile 通常允许。",
    matches: (fact) =>
      fact.sameDirection &&
      isPerfectFifth(fact.previousInterval) &&
      isDiminishedFifth(fact.currentInterval),
  });
}

export function outerDiminishedToPerfectFifthRule(
  context: HarmonyRuleContext,
) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.unequal-fifths-outer-diminished-to-perfect",
    title: "外声部减五度到纯五度",
    message: "男低音与女高音由减五度同向进入纯五度，按斯波索宾口径严格禁止。",
    matches: (fact) =>
      fact.sameDirection &&
      fact.outerVoicesOnly &&
      isDiminishedFifth(fact.previousInterval) &&
      isPerfectFifth(fact.currentInterval),
  });
}

export function innerDiminishedToPerfectFifthRule(
  context: HarmonyRuleContext,
) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.unequal-fifths-inner-diminished-to-perfect",
    title: "内声部减五度到纯五度",
    message:
      "涉及内声部的减五度同向进入纯五度；只有低音上行级进时可按默认口径放宽。",
    matches: (fact) =>
      fact.sameDirection &&
      fact.includesInnerVoice &&
      isDiminishedFifth(fact.previousInterval) &&
      isPerfectFifth(fact.currentInterval),
  });
}

export const VOICE_LEADING_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "voice-leading.overlap",
    catalogNumber: "C.1",
    label: "声部超越",
    description:
      "较低声部的新音高于较高相邻声部的前一音，或较高声部的新音低于较低相邻声部的前一音时触发。",
    rationale: "同和弦转换和明确声部交换允许；不得与同一时刻的声部交叉混淆。",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    supportedExceptionContexts: ["same-harmony", "voice-exchange"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
      "voice-exchange": "exempt",
    },
    evaluate: voiceOverlapRule,
  }),
  defineStatelessRule({
    id: "voice-leading.unequal-fifths-perfect-to-diminished",
    catalogNumber: "C.4.1",
    label: "纯五度到减五度",
    description:
      "连续结构切片中，同一对声部同向实际运动，前一书写音程为纯五度类、后一书写音程为减五度类时命中本规则。",
    rationale:
      "按斯波索宾口径通常允许，尤其是包含内声部或低音级进时；保留为可选规则只为支持更严格的院校 profile。",
    group: "voiceLeading",
    defaultSeverity: "off",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    supportedExceptionContexts: ["same-harmony", "voice-exchange"],
    evaluate: perfectToDiminishedFifthRule,
  }),
  defineStatelessRule({
    id: "voice-leading.unequal-fifths-outer-diminished-to-perfect",
    catalogNumber: "C.4.2",
    label: "外声部减五度到纯五度",
    description:
      "声部对必须恰好为 B-S，连续结构切片中两声部同向实际运动，前一书写音程为减五度类、后一书写音程为纯五度类时触发。",
    rationale:
      "斯波索宾口径严格禁止；不能因同和弦转换或低音级进而自动豁免。用户仍可在规则 profile 中降为警告或关闭。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: outerDiminishedToPerfectFifthRule,
  }),
  defineStatelessRule({
    id: "voice-leading.unequal-fifths-inner-diminished-to-perfect",
    catalogNumber: "C.4.3",
    label: "涉及内声部的减五度到纯五度",
    description:
      "同一对声部包含 A 或 T，连续结构切片中由减五度同向进入纯五度；若全局低音同时按书写音级上行二度，则按斯波索宾口径允许，否则触发。",
    rationale:
      "“低音上行级进”必须按相邻字母音级和实际方向共同判断，不能只检查 1 或 2 个半音；严格 profile 可以选择无视该允许条件继续报告。",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    supportedExceptionContexts: ["bass-step-up"],
    defaultExceptionPolicies: {
      "bass-step-up": "exempt",
    },
    evaluate: innerDiminishedToPerfectFifthRule,
  }),
  defineStatelessRule({
    id: "voice-leading.parallel-fifths",
    catalogNumber: "C.2",
    label: "平行纯五度",
    description:
      "同一对声部在连续有效起奏关系上均形成纯五度类音程，两个声部同向运动且均实际改变音高时触发；复合十二度按五度类处理。",
    rationale:
      "同和弦转换、声部交换和非和弦音都不能自动豁免；装饰音造成的表面平行需按结构音层级校准。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: parallelFifthsRule,
  }),
  defineStatelessRule({
    id: "voice-leading.parallel-octaves",
    catalogNumber: "C.3",
    label: "平行八度或同度",
    description:
      "同一对声部连续形成同度/八度类音程，并且两个声部同向实际运动时触发；跨越多个八度仍按八度类处理。",
    rationale: "同和弦转换不豁免；同音保持且只有一个声部运动不是平行。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: parallelOctavesRule,
  }),
  defineStatelessRule({
    id: "voice-leading.hidden-fifth",
    catalogNumber: "C.5",
    label: "外声部隐伏五度",
    description:
      "男低音与女高音同向运动到纯五度类音程，且女高音以跳进到达时触发。",
    rationale: "女高音级进时通常允许；同和弦转换放宽；必须与真正平行五度去重。",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    supportedExceptionContexts: ["same-harmony"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: hiddenFifthRule,
  }),
  defineStatelessRule({
    id: "voice-leading.hidden-octave",
    catalogNumber: "C.6",
    label: "外声部隐伏八度",
    description:
      "男低音与女高音同向运动到八度/同度类音程，且女高音以跳进到达时触发。",
    rationale: "女高音级进和同和弦转换按教学口径放宽；与平行八度去重。",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    supportedExceptionContexts: ["same-harmony"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: hiddenOctaveRule,
  }),
  defineStatelessRule({
    id: "voice-leading.cross-relation-simultaneous",
    catalogNumber: "C.7",
    label: "同时对斜",
    description:
      "同一切片中不同声部出现相同字母名但不同 accidental 的书写音高，并且不是已确认的特殊变化和弦构成时触发。",
    rationale:
      "增六和弦等合法构成按和弦 identity 豁免；只比较 MIDI pitch class 会产生误判，必须使用 `SpelledPitch`。",
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
  }),
  defineStatelessRule({
    id: "voice-leading.cross-relation-successive",
    catalogNumber: "C.8",
    label: "先后对斜",
    description:
      "一个声部的音结束或延续后，在限定窗口内由另一声部出现同字母异 accidental，且没有合法半音化、转调或和弦解释时触发。",
    rationale:
      "窗口应按起奏链和和声边界定义，不按固定毫秒；变化和弦、共同和弦转调和半音进行需要专用例外。",
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
  }),
);
