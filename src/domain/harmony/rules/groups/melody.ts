import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { formatSpelledPitch, toMidi } from "../../../pitch";
import {
  diagnostic,
  intervalName,
  noteEvidence,
  voiceName,
} from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

function validMelodyTransitions(analysis: HarmonyAnalysis) {
  return analysis.melodyTransitions.filter((transition) => transition.contiguous);
}

export function melodicLeapRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.leap-over-octave" | "melody.large-leap" | "melody.tritone",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const interval = Math.abs(transition.writtenInterval.semitones);
    const writtenName = intervalName(transition.writtenInterval);
    const matches =
      ruleId === "melody.leap-over-octave"
        ? interval > 12
        : ruleId === "melody.large-leap"
          ? interval > 7 && interval <= 12
          : writtenName.altered &&
            ((writtenName.number === 4 && writtenName.quality === "增") ||
              (writtenName.number === 5 && writtenName.quality === "减"));
    if (!matches) return;
    const title =
      ruleId === "melody.leap-over-octave"
        ? "旋律跳进过大"
        : ruleId === "melody.large-leap"
          ? "较大旋律跳进"
          : "旋律三全音";
    const message =
      ruleId === "melody.leap-over-octave"
        ? `${voiceName(analysis, transition.voiceId)}出现超过八度的跳进（${interval} 个半音）。`
        : ruleId === "melody.large-leap"
          ? `${voiceName(analysis, transition.voiceId)}出现大于纯五度的跳进，需检查前后旋律方向。`
          : `${voiceName(analysis, transition.voiceId)}出现三全音跳进。`;
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        title,
        message,
        {
          params: { semitones: interval },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            {
              kind: "interval",
              label: ruleId === "melody.tritone" ? "书写音程" : "音程",
              value:
                ruleId === "melody.tritone"
                  ? writtenName.label
                  : `${interval} 个半音`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function augmentedDiminishedIntervalRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.augmented-interval" | "melody.diminished-interval",
) {
  const diagnostics: RuleDiagnostic[] = [];
  validMelodyTransitions(analysis).forEach((transition) => {
    const named = intervalName(transition.writtenInterval);
    const expectedQuality =
      ruleId === "melody.augmented-interval" ? "增" : "减";
    if (
      !named.altered ||
      named.quality !== expectedQuality ||
      Math.abs(transition.writtenInterval.semitones) === 0
    )
      return;
    diagnostics.push(
      diagnostic(
        ruleId,
        transition.current.startTick,
        transition.current.startTick + transition.current.durationTicks,
        [transition.voiceId],
        [transition.previous, transition.current],
        "旋律出现增减音程",
        `${voiceName(analysis, transition.voiceId)}的 ${formatSpelledPitch(transition.previous.pitch)} 到 ${formatSpelledPitch(transition.current.pitch)} 构成${named.label}。`,
        {
          messageKey: `${ruleId}.${named.quality}`,
          params: {
            intervalNumber: named.number,
            quality: named.quality,
            semitones: Math.abs(transition.writtenInterval.semitones),
          },
          evidence: [
            noteEvidence(transition.previous, "前一音"),
            noteEvidence(transition.current, "当前音"),
            { kind: "interval", label: "书写音程", value: named.label },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function melodicContourRule(
  analysis: HarmonyAnalysis,
  ruleId: "melody.leap-recovery" | "melody.consecutive-leaps",
) {
  const diagnostics: RuleDiagnostic[] = [];
  const byVoice = new Map(
    (["soprano", "alto", "tenor", "bass"] as const).map((voiceId) => [
      voiceId,
      validMelodyTransitions(analysis).filter(
        (transition) => transition.voiceId === voiceId,
      ),
    ]),
  );

  byVoice.forEach((transitions, voiceId) => {
    for (let index = 0; index < transitions.length - 1; index += 1) {
      const first = transitions[index];
      const second = transitions[index + 1];
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
      // 连续同和弦构成音属于明确的分解和弦语境，不在此处限制轮廓。
      if (first.sameHarmony && second.sameHarmony) continue;

      let matches = false;
      if (ruleId === "melody.leap-recovery") {
        const recoveredByOppositeStep =
          Math.sign(secondSemitones) === -Math.sign(firstSemitones) &&
          Math.abs(second.writtenInterval.diatonicSteps) === 1 &&
          Math.abs(secondSemitones) <= 2;
        matches = firstIsLeap && !recoveredByOppositeStep;
      } else {
        const outline =
          toMidi(second.current.pitch) - toMidi(first.previous.pitch);
        const simpleOutline = Math.abs(outline) % 12;
        const consonantOutline = [0, 3, 4, 5, 7, 8, 9].includes(simpleOutline);
        matches =
          firstIsLeap &&
          secondIsLeap &&
          sameDirection &&
          !consonantOutline;
      }
      if (!matches) continue;
      diagnostics.push(
        diagnostic(
          ruleId,
          second.current.startTick,
          second.current.startTick + second.current.durationTicks,
          [voiceId],
          [first.previous, first.current, second.current],
          ruleId === "melody.leap-recovery"
            ? "大跳后没有反向补偿"
            : "同向连续跳进形成不协和轮廓",
          ruleId === "melody.leap-recovery"
            ? `${voiceName(analysis, voiceId)}在大跳后通常应以反向级进收束旋律。`
            : `${voiceName(analysis, voiceId)}连续同向跳进，并形成不协和的总体音程轮廓。`,
          {
            causeRefs: [
              `${ruleId}|${first.id}|${second.id}`,
            ],
            evidence: [
              noteEvidence(first.previous, "轮廓起点"),
              noteEvidence(first.current, "轮廓中点"),
              noteEvidence(second.current, "轮廓终点"),
            ],
          },
        ),
      );
    }
  });
  return diagnostics;
}

export const MELODY_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "melody.leap-over-octave",
    catalogNumber: "B.1",
    label: "超过八度的跳进",
    description: "同一声部的连续起奏音相差大于 12 半音时触发。",
    rationale: "休止会切断连续旋律；同和弦分解也不豁免超过八度的跳进。",
    group: "melody",
    defaultSeverity: "error",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    evaluate: (analysis) =>
    melodicLeapRule(analysis, "melody.leap-over-octave"),
  }),
  defineStatelessRule({
    id: "melody.large-leap",
    catalogNumber: "B.2",
    label: "较大旋律跳进",
    description: "不同和声之间，同一声部连续起奏音的简单音程大于纯五度并且不超过纯八度时触发。",
    rationale: "同和弦转换中的分解和弦跳进放宽；六度和八度是否允许由教学 profile 细分。",
    group: "melody",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    melodicLeapRule(analysis, "melody.large-leap"),
  }),
  defineStatelessRule({
    id: "melody.tritone",
    catalogNumber: "B.5",
    label: "三全音旋律进行",
    description: "这是 B.3/B.4 的专门显示子类；当书写音程为增四度或减五度时提供更具体诊断。",
    rationale: "与 B.3/B.4 共用证据时只显示本条；同和弦转换中的和弦音跳进按适用性计划放宽。",
    group: "melody",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    coveredRuleIds: [
      "melody.augmented-interval",
      "melody.diminished-interval"
    ],
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    melodicLeapRule(analysis, "melody.tritone"),
  }),
  defineStatelessRule({
    id: "melody.augmented-interval",
    catalogNumber: "B.3",
    label: "旋律增音程",
    description: "使用字母级数和升降号计算书写音程，连续起奏音形成增一度、增二度、增四度等增音程时触发。",
    rationale: "同和弦内合法分解和弦、旋律小调特定进行和变化和弦的规范解决由专用规则决定；不能只按半音数判断。",
    group: "melody",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.augmented-interval"),
  }),
  defineStatelessRule({
    id: "melody.diminished-interval",
    catalogNumber: "B.4",
    label: "旋律减音程",
    description: "连续起奏音形成减音程时触发，并记录后继音以判断是否按规范反向解决。",
    rationale: "允许的减七度、减四度等解决模式需要按和弦功能建立金样本；待审定前不升级为错误。",
    group: "melody",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.diminished-interval"),
  }),
  defineStatelessRule({
    id: "melody.leap-recovery",
    catalogNumber: "B.6",
    label: "大跳后的反向补偿",
    description: "大于三度的跳进后，后继起奏音继续同向跳进，或没有在合理窗口内反向级进时触发。",
    rationale: "同和弦分解、序进、经过性低音和明确的旋律轮廓可豁免；“合理窗口”需金样本校准。",
    group: "melody",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    melodicContourRule(analysis, "melody.leap-recovery"),
  }),
  defineStatelessRule({
    id: "melody.consecutive-leaps",
    catalogNumber: "B.7",
    label: "同向连续跳进",
    description: "至少三次连续起奏形成两个同向跳进，并且总轮廓构成七度、九度或其他不协和音程时触发。",
    rationale: "同和弦分解、明确序进或总轮廓为和弦协和音程时放宽。",
    group: "melody",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    supportedExceptionContexts: [
      "same-harmony",
      "arpeggiation"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt"
    },
    evaluate: (analysis) =>
    melodicContourRule(analysis, "melody.consecutive-leaps"),
  }),
);
