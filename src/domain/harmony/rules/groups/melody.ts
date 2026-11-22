import type { HarmonyAnalysis, MelodyTransition } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { toMidi } from "../../../pitch";
import {
  diagnostic,
  intervalName,
  noteEvidence,
  voiceName,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import { isResolvedDominantSixthBass } from "./support/appliedAndDeceptive";
import { isNeapolitanSeventhBassTritone } from "./support/chordSpellingAndDiatonic";
import { sameHarmonyAtMelodicAttack } from "../helpers/motionHarmony";
import {
  previousSeventhInTritoneTransfer,
  augmentedIntervalRule,
  diminishedIntervalRule,
} from "./support/chromaticPassing";

export { augmentedIntervalRule, diminishedIntervalRule };

function validMelodyTransitions(
  context: HarmonyRuleContext,
  voiceId?: MelodyTransition["voiceId"],
) {
  return context
    .melodyTransitions(voiceId ? { voiceId } : undefined)
    .where((transition) => transition.contiguous);
}

type NamedInterval = ReturnType<typeof intervalName>;

interface MelodyTransitionRulePolicy {
  id: "melody.leap-over-octave" | "melody.large-leap" | "melody.tritone";
  matches(interval: number, named: NamedInterval, voiceId: MelodyTransition["voiceId"]): boolean;
  title: string;
  message(
    analysis: HarmonyAnalysis,
    transition: MelodyTransition,
    interval: number,
  ): string;
  evidenceLabel: string;
  evidenceValue(interval: number, named: NamedInterval): string;
}

function evaluateMelodyTransitionRule(
  context: HarmonyRuleContext,
  policy: MelodyTransitionRulePolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const transition of validMelodyTransitions(context)) {
    const interval = Math.abs(transition.writtenInterval.semitones);
    const writtenName = intervalName(transition.writtenInterval);
    if (!policy.matches(interval, writtenName, transition.voiceId)) continue;
    if (policy.id === "melody.tritone" && (isNeapolitanSeventhBassTritone(context, transition) ||
        isResolvedDominantSixthBass(context, transition))) continue;
    const previousSeventh = policy.id === "melody.tritone" ? previousSeventhInTritoneTransfer(context, transition) : undefined;
    const finding = diagnostic(
      policy.id,
      transition.current.startTick,
      transition.current.startTick + transition.current.durationTicks,
      [transition.voiceId],
      [transition.previous, transition.current],
      policy.title,
      policy.message(context.analysis, transition, interval),
      {
        params: { semitones: interval },
        motionSameHarmony: policy.id === "melody.large-leap"
          ? sameHarmonyAtMelodicAttack(context, transition.current.startTick, transition.voiceId,
              transition.voiceId === "bass" && writtenName.number === 6 && writtenName.quality === "小")
          : undefined,
        evidence: [
          noteEvidence(transition.previous, "前一音"),
          noteEvidence(transition.current, "当前音"),
          ...(previousSeventh ? [noteEvidence(previousSeventh, "原声部的七音")] : []),
          {
            kind: "interval",
            label: policy.evidenceLabel,
            value: policy.evidenceValue(interval, writtenName),
          },
        ],
      },
    );
    if (previousSeventh) {
      finding.motionSameHarmony = true;
      finding.melodyTransitionId = transition.id;
      finding.strictDefaultContext = "same-harmony";
    }
    diagnostics.push(finding);
  }
  return diagnostics;
}

const LEAP_OVER_OCTAVE_POLICY: MelodyTransitionRulePolicy = {
  id: "melody.leap-over-octave",
  matches: (interval) => interval > 12,
  title: "旋律跳进过大",
  message: (analysis, transition, interval) =>
    `${voiceName(analysis, transition.voiceId)}出现超过八度的跳进（${interval} 个半音）。`,
  evidenceLabel: "音程",
  evidenceValue: (interval) => `${interval} 个半音`,
};

const LARGE_LEAP_POLICY: MelodyTransitionRulePolicy = {
  id: "melody.large-leap",
  // Spasobin, ch. 6 §4, treats a written bass octave as ordinary bass writing.
  matches: (interval, named, voiceId) =>
    interval > 7 && interval <= 12 &&
    !(voiceId === "bass" && named.number === 8 && named.quality === "纯"),
  title: "较大旋律跳进",
  message: (analysis, transition) =>
    `${voiceName(analysis, transition.voiceId)}出现大于纯五度的跳进，需检查前后旋律方向。`,
  evidenceLabel: "音程",
  evidenceValue: (interval) => `${interval} 个半音`,
};

const TRITONE_POLICY: MelodyTransitionRulePolicy = {
  id: "melody.tritone",
  matches: (semitones, named) =>
    semitones === 6 &&
    ((named.number === 4 && named.quality === "增") ||
      (named.number === 5 && named.quality === "减")),
  title: "旋律三全音",
  message: (analysis, transition) =>
    `${voiceName(analysis, transition.voiceId)}出现三全音跳进。`,
  evidenceLabel: "书写音程",
  evidenceValue: (_interval, named) => named.label,
};

export function leapOverOctaveRule(context: HarmonyRuleContext) {
  return evaluateMelodyTransitionRule(context, LEAP_OVER_OCTAVE_POLICY);
}

export function largeLeapRule(context: HarmonyRuleContext) {
  return evaluateMelodyTransitionRule(context, LARGE_LEAP_POLICY);
}

export function tritoneRule(context: HarmonyRuleContext) {
  return evaluateMelodyTransitionRule(context, TRITONE_POLICY);
}

interface MelodicContourFact {
  voiceId: "soprano" | "alto" | "tenor" | "bass";
  first: MelodyTransition;
  second: MelodyTransition;
  firstIsLeap: boolean;
  secondIsLeap: boolean;
  sameDirection: boolean;
  recoveredByOppositeStep: boolean;
  consonantOutline: boolean;
}

function melodicContourFacts(context: HarmonyRuleContext) {
  const facts: MelodicContourFact[] = [];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
    for (const [first, second] of validMelodyTransitions(context, voiceId).window(2)) {
      if (first.current.id !== second.previous.id) continue;
      const firstSemitones = first.writtenInterval.semitones;
      const secondSemitones = second.writtenInterval.semitones;
      const firstIsLeap =
        Math.abs(first.writtenInterval.diatonicSteps) > 2 ||
        Math.abs(firstSemitones) > 4;
      const secondIsLeap =
        Math.abs(second.writtenInterval.diatonicSteps) > 2 ||
        Math.abs(secondSemitones) > 4;
      const sameDirection =
        Math.sign(firstSemitones) !== 0 &&
        Math.sign(firstSemitones) === Math.sign(secondSemitones);
      if (first.sameHarmony && second.sameHarmony) continue;
      const recoveredByOppositeStep =
        Math.sign(secondSemitones) === -Math.sign(firstSemitones) &&
        Math.abs(second.writtenInterval.diatonicSteps) === 1 &&
        Math.abs(secondSemitones) <= 2;
      const outline =
        toMidi(second.current.pitch) - toMidi(first.previous.pitch);
      const consonantOutline = [0, 3, 4, 5, 7, 8, 9].includes(
        Math.abs(outline) % 12,
      );
      facts.push({
        voiceId,
        first,
        second,
        firstIsLeap,
        secondIsLeap,
        sameDirection,
        recoveredByOppositeStep,
        consonantOutline,
      });
    }
  }
  return facts;
}

function contourDiagnostic(
  analysis: HarmonyAnalysis,
  fact: MelodicContourFact,
  ruleId: "melody.leap-recovery" | "melody.consecutive-leaps",
  title: string,
  message: string,
) {
  return diagnostic(
    ruleId,
    fact.second.current.startTick,
    fact.second.current.startTick + fact.second.current.durationTicks,
    [fact.voiceId],
    [fact.first.previous, fact.first.current, fact.second.current],
    title,
    message,
    {
      causeRefs: [`${ruleId}|${fact.first.id}|${fact.second.id}`],
      evidence: [
        noteEvidence(fact.first.previous, "轮廓起点"),
        noteEvidence(fact.first.current, "轮廓中点"),
        noteEvidence(fact.second.current, "轮廓终点"),
      ],
    },
  );
}

export function leapRecoveryRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  melodicContourFacts(context).forEach((fact) => {
    if (!fact.firstIsLeap || fact.recoveredByOppositeStep) return;
    diagnostics.push(
      contourDiagnostic(
        analysis,
        fact,
        "melody.leap-recovery",
        "大跳后没有反向补偿",
        `${voiceName(analysis, fact.voiceId)}在大跳后通常应以反向级进收束旋律。`,
      ),
    );
  });
  return diagnostics;
}

export function consecutiveLeapsRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  melodicContourFacts(context).forEach((fact) => {
    if (
      !fact.firstIsLeap ||
      !fact.secondIsLeap ||
      !fact.sameDirection ||
      fact.consonantOutline
    )
      return;
    diagnostics.push(
      contourDiagnostic(
        analysis,
        fact,
        "melody.consecutive-leaps",
        "同向连续跳进形成不协和轮廓",
        `${voiceName(analysis, fact.voiceId)}连续同向跳进，并形成不协和的总体音程轮廓。`,
      ),
    );
  });
  return diagnostics;
}

export const MELODY_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "melody.leap-over-octave",
    catalogNumber: "B.1",
    label: "超过八度的跳进",
    description: "检查单声部旋律中是否出现了超过纯八度的跳进。",
    rationale:
      "古典和声声部进行以级进和小跳为主。旋律超过纯八度的大跳极难歌唱且容易割裂声部线条的连续性，在传统四部和声的任何声部中均被严格禁止。",
    group: "melody",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "note",
    evaluate: leapOverOctaveRule,
  }),
  defineStatelessRule({
    id: "melody.large-leap",
    catalogNumber: "B.2",
    label: "较大旋律跳进",
    description:
      "检查同一声部大于纯五度且不超过八度的跳进，低音的书写纯八度按常规写法处理。",
    rationale:
      "在和弦连接中，较大的旋律跳进需要结合前后方向与和弦转换检查。斯波索宾第六章第四节把低音纯八度列为正常的低音写法，可在这一位置转换和弦排列。其他大跳仍提示检查旋律方向。",
    group: "melody",
    defaultSeverity: "suggestion",
    requires: ["written-pitches"],
    dependencyScope: "note",
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: largeLeapRule,
  }),
  defineStatelessRule({
    id: "melody.tritone",
    catalogNumber: "B.5",
    label: "三全音旋律进行",
    description:
      "检查单声部旋律中是否出现未妥善解决的三全音（增四度或减五度）跳进。",
    rationale:
      "斯波索宾第 10、18 章允许下属到属六的低音下跳减五度后半音上行至主音。第 47 章另允许原位降Ⅱ七到原位属七的低音上行增四度或下行减五度。默认的同和声豁免限于一般换位，实写属七的三音下跳增四度接手另一声部的七音时报告。",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    coveredRuleIds: ["melody.augmented-interval", "melody.diminished-interval"],
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    contextualDefaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: tritoneRule,
  }),
  defineStatelessRule({
    id: "melody.augmented-interval",
    catalogNumber: "B.3",
    label: "旋律增音程",
    description:
      "检查增二度等旋律增音程，以及有谱面依据的半音错拼。",
    rationale:
      "斯波索宾第 32 章说明半音变化通常在同一声部进行。普通增一度可以用于和弦衔接或装饰；只有和弦结构或第 41 章的半音经过写法足以确定另一个拼写时，才提示改写。更大的增音程按实写音程检查。",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: augmentedIntervalRule,
  }),
  defineStatelessRule({
    id: "melody.diminished-interval",
    catalogNumber: "B.4",
    label: "旋律减音程",
    description:
      "检查单声部旋律进行中的减音程是否在跳进后反向级进解决。",
    rationale:
      "减音程（如减五度、减四度、减七度等）具有向内收缩的倾向性。古典和声允许适当使用减音程跳进，但该跳进后必须立即反向级进折回（即跳入减音程所包围的内部音），以平息不协和倾向并恢复旋律平衡。",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: diminishedIntervalRule,
  }),
  defineStatelessRule({
    id: "melody.leap-recovery",
    catalogNumber: "B.6",
    label: "大跳后的反向补偿",
    description:
      "检查声部在大跳（四度及以上）之后是否及时进行了反向级进补偿。",
    rationale:
      "根据旋律波形平衡原则，大跳进产生强烈的动能与张力，容易破坏旋律平稳性。传统的良好旋律线条要求在大跳之后，下一步声部进行应当反向级进折回，以平衡能量并维持声部歌唱性。",
    group: "melody",
    defaultSeverity: "off",
    requires: ["written-pitches"],
    dependencyScope: "note",
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: leapRecoveryRule,
  }),
  defineStatelessRule({
    id: "melody.consecutive-leaps",
    catalogNumber: "B.7",
    label: "同向连续跳进",
    description:
      "检查声部是否出现同向连续跳进并形成了不协和的音程总轮廓。",
    rationale:
      "声部沿同一方向连续跳进（如两个四度跳进），会使两个端点音构成七度或九度等不协和轮廓（音程总括），破坏旋律的调式骨架与平稳性。同向跳进仅在分解同一和弦的和弦音时方可例外允许。",
    group: "melody",
    defaultSeverity: "suggestion",
    requires: ["written-pitches"],
    dependencyScope: "note",
    supportedExceptionContexts: ["same-harmony", "arpeggiation"],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
    },
    evaluate: consecutiveLeapsRule,
  }),
);
