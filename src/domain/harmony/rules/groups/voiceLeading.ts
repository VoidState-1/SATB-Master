import type { AnalysisNote, AnalysisSlice, SliceTransition } from "../../analysis";
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
import { isCadentialContraryOctave } from "./cadentialContraryOctaves";
import { sameHarmonyOnTransition } from "../helpers/motionHarmony";

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
      const leftKey = context.keyAt(left.note.startTick);
      const rightKey = context.keyAt(right.note.startTick);
      if (!leftKey || !rightKey) continue;
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
  matches(fact: VoicePairTransitionFact, transition: SliceTransition): boolean;
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
      if (!policy.matches(fact, transition)) continue;
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
            motionSameHarmony: policy.id === "voice-leading.hidden-fifth"
              ? sameHarmonyOnTransition(transition, context.harmony) : undefined,
            pairMotion: {
              voiceExchange: fact.voiceExchange,
              bassStepUp: fact.bassMotion === "step-up",
            },
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
    title: "平行或反向纯五度",
    message: "两个声部同向或反向移动，并连续形成纯五度（含复音程）。",
    matches: (fact) =>
      bothVoicesMove(fact) &&
      isPerfectFifth(fact.previousInterval) &&
      isPerfectFifth(fact.currentInterval),
  });
}

export function parallelOctavesRule(context: HarmonyRuleContext) {
  return evaluateVoicePairRule(context, {
    id: "voice-leading.parallel-octaves",
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
      "检查任意两个声部是否同向或反向进行并连续构成纯五度（含纯十二度等复音程）；持续音或重复同音不计入。",
    rationale:
      "纯五度的声学共鸣高度融合。两个声部同向或反向连续形成纯五度及其复音程，都会削弱声部独立性，因此一并检查。斜向进行及两个声部均重复同音时不按连续五度处理。",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: parallelFifthsRule,
  }),
  defineStatelessRule({
    id: "voice-leading.parallel-octaves",
    catalogNumber: "C.3",
    label: "平行或反向八度、同度",
    description:
      "检查任意两个声部是否同向或反向进行并连续构成纯八度或同度（含纯十五度等复音程）；持续音或重复同音不计入。",
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
  defineStatelessRule({
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
  }),
  defineStatelessRule({
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
  }),
);
