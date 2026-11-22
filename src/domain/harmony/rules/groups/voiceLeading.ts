import type { SliceTransition } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { VOICE_ORDER } from "../../../project/voice";
import { toMidi } from "../../../pitch";
import {
  type VoicePairTransitionFact,
} from "../sharedFacts";
import {
  diagnostic,
  isDiminishedFifth,
  isPerfectFifth,
  noteEvidence,
  pitchClass,
  voiceName,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import {
  isCadentialContraryOctave,
  isClosingCadentialOverlap,
  preparedSuspensionParallel,
} from "./support/suspensionsAndVoiceLeading";
import { mozartFifths } from "./support/augmentedSixth";
import type { RuleConfig, RuleExceptionPolicy } from "../types";
import {
  SIMULTANEOUS_CROSS_RELATION_RULE,
  SUCCESSIVE_CROSS_RELATION_RULE,
} from "./crossRelations";
import { sameHarmonyOnTransition } from "../helpers/motionHarmony";

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
  matches(fact: VoicePairTransitionFact, transition: SliceTransition): boolean;
  delayedInterval?: (interval: VoicePairTransitionFact["currentInterval"]) => boolean;
  sameHarmony?(transition: SliceTransition): boolean;
  details?(fact: VoicePairTransitionFact, transition: SliceTransition, immediate: boolean): {
    title?: string;
    message?: string;
    severityCap?: RuleDiagnostic["severityCap"];
    cadence?: boolean;
    innerVoices?: boolean;
  };
}

function isPerfectOctave(interval: VoicePairTransitionFact["currentInterval"]) {
  return (
    Math.abs(interval.diatonicSteps) % 7 === 0 &&
    pitchClass(interval.semitones) === 0
  );
}

function bothVoicesMove(fact: VoicePairTransitionFact) {
  return fact.upperMotion !== "stationary" && fact.lowerMotion !== "stationary";
}

function evaluateVoicePairRule(
  context: HarmonyRuleContext,
  policy: VoicePairRulePolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const transition of context.sliceTransitions()) {
    for (const fact of context.voiceLeading.voicePairs(transition)) {
      const immediate = policy.matches(fact, transition);
      const delayed = !immediate && policy.delayedInterval?.(fact.currentInterval)
        ? preparedSuspensionParallel(context, transition, fact, policy.delayedInterval)
        : undefined;
      if (!immediate && !delayed) continue;
      const details = policy.details?.(fact, transition, immediate);
      const [upperId, lowerId] = fact.voiceIds;
      const [previousUpper, previousLower] = delayed
        ? [delayed.held, delayed.lowerBefore]
        : fact.previousNotes;
      const [currentUpper, currentLower] = fact.currentNotes;
      diagnostics.push(
        diagnostic(
          policy.id,
          transition.current.tick,
          transition.current.endTick,
          [upperId, lowerId],
          [previousUpper, previousLower, currentUpper, currentLower],
          details?.title ?? policy.title,
          delayed ? "两声部依次作下行级进，延留解决后重现相同的纯音程。" : details?.message ?? policy.message,
          {
            motionSameHarmony: policy.sameHarmony?.(transition),
            severityCap: details?.severityCap,
            ...(delayed && { params: { suspensionEntryTick: delayed.entryTick } }),
            ...((immediate || details) && {
              pairMotion: {
                voiceExchange: immediate ? fact.voiceExchange : undefined,
                bassStepUp: immediate ? fact.bassMotion === "step-up" : undefined,
                cadence: details?.cadence,
                innerVoices: details?.innerVoices,
              },
            }),
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

export function parallelFifthsRule(
  context: HarmonyRuleContext, _config: RuleConfig, exceptionPolicy: RuleExceptionPolicy = {},
) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.parallel-fifths",
    delayedInterval: isPerfectFifth,
    title: "平行或反向纯五度",
    message: "两个声部同向或反向移动，并连续形成纯五度（含复音程）。",
    matches: (fact) =>
      bothVoicesMove(fact) &&
      isPerfectFifth(fact.previousInterval) &&
      isPerfectFifth(fact.currentInterval),
    details: (fact, transition, immediate) => {
      const mozart = immediate ? mozartFifths(context, transition, fact) : undefined;
      if (!mozart || exceptionPolicy["inner-voices"] === "strict") return { innerVoices: !!mozart };
      return {
        innerVoices: true,
        severityCap: "suggestion",
        ...(mozart === "triad" ? {
          title: "莫扎特五度（教材许可）",
          message: "斯波索宾 §30.4 允许德增六直进属三和弦时低音与内声部出现平行纯五度，外声部仍禁止。",
        } : {
          title: "莫扎特五度变体（德增六进属七）",
          message: "德增六直进属七且高端下行成为属七的七音时，允许低音与内声部出现平行纯五度，外声部仍禁止。",
        }),
      };
    },
  });
}

export function parallelOctavesRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.parallel-octaves",
    delayedInterval: isPerfectOctave,
    title: "平行或反向八度、同度",
    message: "两个声部同向或反向移动，并连续形成纯八度或同度（含复音程）。",
    matches: (fact, transition) =>
      bothVoicesMove(fact) &&
      isPerfectOctave(fact.previousInterval) &&
      isPerfectOctave(fact.currentInterval) &&
      !(fact.outerVoicesOnly && !fact.sameDirection && isCadentialContraryOctave(context, transition)),
  });
}

export function hiddenFifthRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.hidden-fifth",
    sameHarmony: transition => sameHarmonyOnTransition(transition, context.harmony),
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
    // Only the two slices compared for overlap can establish this exemption.
    sameHarmony: transition => sameHarmonyOnTransition(transition, context.harmony),
    title: "声部重叠",
    message: "当前声部进入了相邻声部上一位置所占据的音域。",
    details: (fact, transition) => ({ cadence: isClosingCadentialOverlap(context, transition, fact) }),
    matches: (fact) => {
      const [upperId, lowerId] = fact.voiceIds;
      const adjacent =
        VOICE_ORDER.indexOf(lowerId) === VOICE_ORDER.indexOf(upperId) + 1;
      const previousUpper = toMidi(fact.previousNotes[0].pitch);
      const previousLower = toMidi(fact.previousNotes[1].pitch);
      // 起点已经交叉时，保持或恢复音域不会构成一次新的横向超越。
      return (
        adjacent &&
        previousUpper >= previousLower &&
        (toMidi(fact.currentNotes[0].pitch) < previousLower ||
          toMidi(fact.currentNotes[1].pitch) > previousUpper)
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
      "检查后一和弦中较低声部是否高过了前一和弦中相邻较高声部的音高（或反之）。",
    rationale:
      "声部超越（Voice Overlap）发生在横向进行上，即一个声部越过了相邻声部刚刚唱过的音高界限。这会使听觉误以为声部线条发生了突兀跳跃或声部合并，破坏各声部线条独立行进的清晰度。",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["same-harmony", "voice-exchange", "cadence"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
      "voice-exchange": "exempt",
    },
    contextualDefaultExceptionPolicies: { cadence: "exempt" },
    evaluate: voiceOverlapRule,
  }),
  defineStatelessRule({
    id: "voice-leading.unequal-fifths-perfect-to-diminished",
    catalogNumber: "C.4.1",
    label: "纯五度到减五度",
    description:
      "检查两个声部同向运动时是否由纯五度进入减五度。",
    rationale:
      "由纯五度同向进入减五度，音程性质由完全协和变为不协和，声部倾向性发生了质的转变。斯波索宾等古典和声体系中在内声部或低音级进时通常允许，但在部分极其严谨的对位法中仍作为提示关注。",
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
      "检查外声部（女高音与男低音）同向运动时是否由减五度进入纯五度。",
    rationale:
      "减五度到纯五度是不协和音程向完全协和音程的同向开放，外声部（S-B）处于听觉最敏感的边缘位置，同向进入纯五度极易产生平行五度的空洞听感与倾向音解决不良，在古典和声学中被严格禁止。",
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
      "检查涉及内声部（A 或 T）时，是否由减五度同向进入纯五度且低音未上行级进。",
    rationale:
      "涉及内声部由减五度进入纯五度时，如果低音声部呈二度上行级进（如 Ⅶ7 到 Ⅰ 的典型解决），内声部的五度变换被低音的强烈支持所掩盖，斯波索宾和声学允许此用法；若低音非上行级进，则容易暴露空洞五度。",
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
    label: "平行或反向纯五度",
    description:
      "检查任意两个声部是否同向或反向进行并连续构成纯五度（含纯十二度等复音程），以及有准备的延留下行解决是否掩盖同向纯五度。",
    rationale:
      "纯五度的声学共鸣高度融合。两个声部同向或反向连续形成纯五度及其复音程，都会削弱声部独立性，因此一并检查。斜向进行及两个声部均重复同音时不按连续五度处理。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "project",
    supportedExceptionContexts: ["inner-voices"],
    contextualDefaultExceptionPolicies: { "inner-voices": "downgrade" },
    evaluate: parallelFifthsRule,
  }),
  defineStatelessRule({
    id: "voice-leading.parallel-octaves",
    catalogNumber: "C.3",
    label: "平行或反向八度、同度",
    description:
      "检查任意两个声部是否同向或反向进行并连续构成纯八度或同度（含纯十五度等复音程），以及有准备的延留下行解决是否掩盖同向八度。",
    rationale:
      "纯八度与同度的连续进行会削弱声部独立性。斯波索宾第十六章第三节允许结束终止中，不完全原位属七到主和弦的特定外声部反行。仅在实奏和声、内声部解决和实际收束均得到支持时适用。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "project",
    evaluate: parallelOctavesRule,
  }),
  defineStatelessRule({
    id: "voice-leading.hidden-fifth",
    catalogNumber: "C.5",
    label: "外声部隐伏五度",
    description:
      "检查外声部（高音与低音）同向跳进进入纯五度。",
    rationale:
      "当高音声部与低音声部同方向运动且高音声部为跳进时，人耳会不自觉地在高音跳进的空隙中脑补出经过音，从而产生“隐伏的平行五度”不良听感。若高音声部为级进，则旋律线条的连贯性能够掩盖此现象。",
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
      "检查外声部（高音与低音）同向跳进进入纯八度或同度。",
    rationale:
      "外声部同向跳进进入纯八度会形成极其刺眼的“隐伏八度”空洞感，削弱外声部对和声织体的张力支撑。要求高音声部必须以级进进入八度，或两外声部反向进行。",
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
  SIMULTANEOUS_CROSS_RELATION_RULE,
  SUCCESSIVE_CROSS_RELATION_RULE,
);
