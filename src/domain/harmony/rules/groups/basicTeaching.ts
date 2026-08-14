import {
  chordIdentityToneSpellings,
} from "../../../chordModel";
import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  leadingTonePitchClass,
  pitchClassEquals,
  pitchClassValue,
  scaleDegreePitchClass,
  stepIndex,
  toMidi,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordInversion,
  chordLabel,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

const UPPER_VOICES = ["soprano", "alto", "tenor"] as const;

function simplePitchClassDistance(left: number, right: number) {
  const direct = Math.abs(left - right) % 12;
  return Math.min(direct, 12 - direct);
}

function isPlainTriad(
  chord: NonNullable<HarmonyAnalysis["slices"][number]["chord"]>,
) {
  return (
    chord.identity.structure.kind === "tertian" &&
    chord.identity.structure.extensions.length === 0 &&
    chord.identity.structure.alterations.length === 0 &&
    chordIdentityToneSpellings(chord.identity).length === 3
  );
}

function chordToneCounts(
  slice: HarmonyAnalysis["slices"][number],
  tones: ReturnType<typeof chordIdentityToneSpellings>,
) {
  const active = activeNotes(slice);
  return {
    active,
    counts: tones.map(
      (tone) =>
        active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
    ),
  };
}

export function incompleteSatbRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  if (!analysis.project.ruleProfile.shared.strictFourPartTexture)
    return diagnostics;

  for (const slice of context.slices()) {
    if (!slice.chord || slice.completeSatb) continue;
    const missing = VOICE_ORDER.filter((voiceId) => !slice.notes[voiceId]);
    diagnostics.push(
      diagnostic(
        "voice.incomplete-satb",
        slice.tick,
        slice.endTick,
        [],
        [],
        "四声部配置不完整",
        `${chordLabel(slice.chord)} 所在位置缺少 ${missing.join("、")} 声部。严格四声部模式要求和弦区间内 SATB 同时存在。`,
        {
          chordIds: [slice.chord.id],
          params: { missingVoices: missing.join(",") },
          evidence: [chordEvidence(slice.chord)],
        },
      ),
    );
  }
  return diagnostics;
}

export function allVoicesSimilarRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const transition of context.sliceTransitions()) {
    if (
      !transition.contiguous ||
      !transition.previous.completeSatb ||
      !transition.current.completeSatb ||
      transition.changedVoiceIds.length !== VOICE_ORDER.length ||
      !VOICE_ORDER.every((voiceId) =>
        transition.current.attackVoiceIds.includes(voiceId),
      )
    )
      continue;
    const directions = VOICE_ORDER.map((voiceId) => {
      const previous = transition.previous.notes[voiceId]!;
      const current = transition.current.notes[voiceId]!;
      return Math.sign(toMidi(current.pitch) - toMidi(previous.pitch));
    });
    if (
      directions[0] === 0 ||
      !directions.every((item) => item === directions[0])
    )
      continue;
    const notes = VOICE_ORDER.flatMap((voiceId) => [
      transition.previous.notes[voiceId]!,
      transition.current.notes[voiceId]!,
    ]);
    diagnostics.push(
      diagnostic(
        "voice-leading.all-voices-similar",
        transition.current.tick,
        transition.current.endTick,
        [...VOICE_ORDER],
        notes,
        "四声部同向进行",
        `四个声部在同一结构位置全部向${directions[0] > 0 ? "上" : "下"}移动，织体独立性较弱。`,
        {
          causeRefs: [`voice-leading.all-voices-similar|${transition.id}`],
          evidence: VOICE_ORDER.map((voiceId) =>
            noteEvidence(
              transition.current.notes[voiceId]!,
              `${voiceId} 当前音`,
            ),
          ),
        },
      ),
    );
  }
  return diagnostics;
}

function triadVoicingFacts(context: HarmonyRuleContext, inversion: 0 | 1 | 2) {
  return context
    .slices()
    .selectMany((slice) => {
      const chord = slice.chord;
      if (
        !chord ||
        !slice.completeSatb ||
        context.sliceTransitions({ fromSliceIndex: slice.index }).first()
          ?.sameHarmony ||
        !isPlainTriad(chord) ||
        chordInversion(chord) !== inversion
      )
        return [];
      const tones = chordIdentityToneSpellings(chord.identity);
      const { active, counts } = chordToneCounts(slice, tones);
      if (counts.some((count) => count === 0)) return [];
      return [{ slice, chord, tones, active, counts, inversion }];
    })
    .toArray();
}

function triadVoicingDiagnostic(
  fact: ReturnType<typeof triadVoicingFacts>[number],
  ruleId:
    | "chord.triad-root-position-doubling"
    | "chord.first-inversion-doubling"
    | "chord.second-inversion-voicing",
  title: string,
  explanation: string,
) {
  return diagnostic(
    ruleId,
    fact.slice.tick,
    fact.slice.endTick,
    [],
    [],
    title,
    `${chordLabel(fact.chord)}：${explanation}`,
    {
      chordIds: [fact.chord.id],
      params: { counts: fact.counts.join("/"), inversion: fact.inversion },
      evidence: [
        chordEvidence(fact.chord),
        ...fact.active.map(({ note }) => noteEvidence(note, "当前配置")),
      ],
    },
  );
}

export function rootPositionTriadDoublingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  triadVoicingFacts(context, 0).forEach((fact) => {
    if (
      fact.chord.identity.structure.kind === "tertian" &&
      fact.chord.identity.structure.quality === "diminished"
    )
      return;
    const leadingTone = leadingTonePitchClass(fact.slice.key);
    if (
      fact.counts.some(
        (count, index) =>
          count > 1 && pitchClassEquals(fact.tones[index], leadingTone),
      )
    )
      return;
    if (fact.counts[0] === 2) return;
    diagnostics.push(
      triadVoicingDiagnostic(
        fact,
        "chord.triad-root-position-doubling",
        "三和弦重复音不符合常用配置",
        "完整的原位大、小三和弦通常重复根音。",
      ),
    );
  });
  return diagnostics;
}

export function firstInversionTriadDoublingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  triadVoicingFacts(context, 1).forEach((fact) => {
    const resolution = context.harmony.primaryInterpretation(fact.chord);
    const interpretation =
      resolution.status === "resolved" ? resolution.value : undefined;
    const preferBass =
      fact.chord.identity.structure.kind === "tertian" &&
      (fact.chord.identity.structure.quality === "diminished" ||
        interpretation?.degree === 2);
    const valid = preferBass
      ? fact.counts[1] === 2
      : fact.counts[0] === 2 || fact.counts[2] === 2;
    if (valid) return;
    diagnostics.push(
      triadVoicingDiagnostic(
        fact,
        "chord.first-inversion-doubling",
        "三和弦重复音不符合常用配置",
        preferBass
          ? "减三和弦或 SII6 通常重复六和弦低音。"
          : "一般六和弦优先重复根音或五音；重复三音需要明确的连接理由。",
      ),
    );
  });
  return diagnostics;
}

export function secondInversionTriadVoicingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  triadVoicingFacts(context, 2).forEach((fact) => {
    const role = fact.chord.semantics?.cadenceRole;
    if (
      fact.counts[2] === 2 &&
      (role === "cadential64" || role === "passing64" || role === "pedal64")
    )
      return;
    diagnostics.push(
      triadVoicingDiagnostic(
        fact,
        "chord.second-inversion-voicing",
        "四六和弦配置缺少依据",
        "四六和弦通常重复低音，并应明确标注为终止、经过或辅助四六。",
      ),
    );
  });
  return diagnostics;
}

function commonToneState(
  source: HarmonyAnalysis["slices"][number],
  target: HarmonyAnalysis["slices"][number],
) {
  const sourceTones = chordIdentityToneSpellings(source.chord!.identity);
  const targetTones = chordIdentityToneSpellings(target.chord!.identity);
  const common = sourceTones.filter((tone) =>
    targetTones.some((candidate) => pitchClassEquals(tone, candidate)),
  );
  const heldVoices = UPPER_VOICES.filter((voiceId) => {
    const before = source.notes[voiceId];
    const after = target.notes[voiceId];
    return Boolean(
      before &&
      after &&
      toMidi(before.pitch) === toMidi(after.pitch) &&
      common.some((tone) => pitchClassEquals(before.pitch, tone)),
    );
  });
  return { common, heldVoices };
}

function basicConnectionFacts(context: HarmonyRuleContext) {
  return context
    .connections()
    .selectMany((candidate) => {
      const { connection, sourceBoundary, targetBoundary } = candidate;
    if (
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown" ||
      connection.relation === "same-harmony"
    )
      return [];
    if (
      !sourceBoundary.completeSatb ||
      !targetBoundary.completeSatb ||
      !sourceBoundary.chord ||
      !targetBoundary.chord ||
      !isPlainTriad(sourceBoundary.chord) ||
      !isPlainTriad(targetBoundary.chord) ||
      chordInversion(sourceBoundary.chord) !== 0 ||
      chordInversion(targetBoundary.chord) !== 0
    )
      return [];
    const sourceRoot = pitchClassValue(sourceBoundary.chord.identity.root);
    const targetRoot = pitchClassValue(targetBoundary.chord.identity.root);
    const rootDistance = simplePitchClassDistance(sourceRoot, targetRoot);
    const writtenRootDirect = Math.abs(
        stepIndex(sourceBoundary.chord.identity.root.step) -
        stepIndex(targetBoundary.chord.identity.root.step),
    );
    const writtenRootDistance = Math.min(
      writtenRootDirect,
      7 - writtenRootDirect,
    );
    const { common, heldVoices } = commonToneState(
      sourceBoundary,
      targetBoundary,
    );
    const upperMotion = UPPER_VOICES.map((voiceId) => ({
      voiceId,
      semitones:
        toMidi(targetBoundary.notes[voiceId]!.pitch) -
        toMidi(sourceBoundary.notes[voiceId]!.pitch),
    }));
    const bassMotion =
      toMidi(targetBoundary.notes.bass!.pitch) -
      toMidi(sourceBoundary.notes.bass!.pitch);
      return [
        {
          connection,
          boundary: { source: sourceBoundary, target: targetBoundary },
          rootDistance,
          writtenRootDistance,
          common,
          heldVoices,
          upperMotion,
          bassMotion,
        },
      ];
    })
    .toArray();
}

type BasicConnectionFact = ReturnType<typeof basicConnectionFacts>[number];

function basicConnectionDiagnostic(
  fact: BasicConnectionFact,
  ruleId:
    | "connection.common-tone-fourth-fifth"
    | "connection.second-relation-contrary-motion"
    | "connection.common-tone-third"
    | "connection.nonparsimonious-motion",
  title: string,
  message: string,
) {
  const notes = VOICE_ORDER.flatMap((voiceId) => [
    fact.boundary.source.notes[voiceId]!,
    fact.boundary.target.notes[voiceId]!,
  ]);
  return diagnostic(
    ruleId,
    fact.boundary.target.tick,
    fact.boundary.target.endTick,
    [...UPPER_VOICES] as VoiceId[],
    notes,
    title,
    message,
    {
      chordIds: [
        fact.boundary.source.chord!.id,
        fact.boundary.target.chord!.id,
      ],
      params: {
        rootDistance: fact.rootDistance,
        commonTones: fact.common.length,
        heldCommonTones: fact.heldVoices.length,
      },
      causeRefs: [`${ruleId}|${fact.connection.connectionKey}`],
      evidence: [
        chordEvidence(fact.boundary.source.chord!),
        chordEvidence(fact.boundary.target.chord!),
      ],
    },
  );
}

export function commonToneFourthFifthRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  basicConnectionFacts(context).forEach((fact) => {
    if (
      fact.rootDistance !== 5 ||
      fact.writtenRootDistance !== 3 ||
      fact.common.length === 0 ||
      fact.heldVoices.length > 0
    )
      return;
    diagnostics.push(
      basicConnectionDiagnostic(
        fact,
        "connection.common-tone-fourth-fifth",
        "四五度关系连接未保持共同音",
        "两个原位三和弦相距四、五度时，通常由同一上方声部保持共同音。",
      ),
    );
  });
  return diagnostics;
}

export function secondRelationContraryMotionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  basicConnectionFacts(context).forEach((fact) => {
    if (
      (fact.rootDistance !== 1 && fact.rootDistance !== 2) ||
      fact.writtenRootDistance !== 1 ||
      fact.common.length > 0
    )
      return;
    const bassDirection = Math.sign(fact.bassMotion);
    const violates =
      bassDirection !== 0 &&
      fact.upperMotion.some(
        ({ semitones }) =>
          Math.sign(semitones) !== -bassDirection || Math.abs(semitones) > 4,
      );
    if (!violates) return;
    diagnostics.push(
      basicConnectionDiagnostic(
        fact,
        "connection.second-relation-contrary-motion",
        "二度关系连接未采用反向最近进行",
        "无共同音的二度关系三和弦，通常让上三声部与低音反向并采用最近进行。",
      ),
    );
  });
  return diagnostics;
}

export function commonToneThirdRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  basicConnectionFacts(context).forEach((fact) => {
    if (
      (fact.rootDistance !== 3 && fact.rootDistance !== 4) ||
      fact.writtenRootDistance !== 2 ||
      fact.common.length < 2 ||
      fact.heldVoices.length >= 2
    )
      return;
    diagnostics.push(
      basicConnectionDiagnostic(
        fact,
        "connection.common-tone-third",
        "三度关系连接未充分保持共同音",
        "三度关系三和弦通常保持两个共同音，仅移动其余声部。",
      ),
    );
  });
  return diagnostics;
}

export function nonparsimoniousMotionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  basicConnectionFacts(context).forEach((fact) => {
    const totalMotion = fact.upperMotion.reduce(
      (sum, item) => sum + Math.abs(item.semitones),
      0,
    );
    const largeMovers = fact.upperMotion.filter(
      ({ semitones }) => Math.abs(semitones) > 4,
    );
    const failedCommonTone =
      fact.common.length > 0 && fact.heldVoices.length === 0;
    if (
      largeMovers.length < 2 ||
      totalMotion < 12 ||
      (!failedCommonTone && totalMotion < 16)
    )
      return;
    diagnostics.push(
      basicConnectionDiagnostic(
        fact,
        "connection.nonparsimonious-motion",
        "存在不必要的大幅声部移动",
        `当前上三声部总移动 ${totalMotion} 个半音，且多个声部进行了可避免的大幅移动。`,
      ),
    );
  });
  return diagnostics;
}

export const BASIC_TEACHING_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "voice.incomplete-satb",
    catalogNumber: "A.5",
    label: "四声部不完整",
    description:
      "在启用“严格四声部习题”profile 且和弦区间要求完整配置时，任一 SATB 声部没有有效音符即触发。",
    rationale:
      "弱起、分句休止、导入后的未完成片段和自由写作 profile 默认不检查。",
    group: "voice",
    defaultSeverity: "suggestion",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: incompleteSatbRule,
  }),
  defineStatelessRule({
    id: "voice-leading.all-voices-similar",
    catalogNumber: "C.9",
    label: "四声部同向进行",
    description:
      "相邻结构切片中四个 SATB 声部全部实际起奏并向同一方向移动时提示。",
    rationale:
      "本条只评价织体独立性；若同时产生平行五八度，只显示更具体的平行诊断为主。",
    group: "voiceLeading",
    defaultSeverity: "suggestion",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: allVoicesSimilarRule,
  }),
  defineStatelessRule({
    id: "chord.triad-root-position-doubling",
    catalogNumber: "D.5",
    label: "原位三和弦重复音",
    description:
      "完整四声部原位三和弦通常应重复根音；重复三音或省略必要构成音时根据和弦级数、调式和连接语境提示。",
    rationale:
      "不得与“重复导音”等硬限制重复报警；具体副三和弦允许的重复方式需由 voicing profile 给出。",
    group: "chord",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: rootPositionTriadDoublingRule,
  }),
  defineStatelessRule({
    id: "chord.first-inversion-doubling",
    catalogNumber: "D.6",
    label: "六和弦重复音",
    description:
      "根据具体功能和级数选择允许/优先的重复音；导音、变化音和不稳定三音不得因一般“自由重复”而被重复。",
    rationale:
      "`SII6`、减三和弦、经过六和弦等必须使用各自 profile，不能用一条“所有六和弦都重复低音”的简化规则。",
    group: "chord",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: firstInversionTriadDoublingRule,
  }),
  defineStatelessRule({
    id: "chord.second-inversion-voicing",
    catalogNumber: "D.7",
    label: "四六和弦配置",
    description:
      "检查低音是否为五音、通常是否重复低音，以及该四六和弦是否具有终止、经过、辅助或持续低音等可解释语境。",
    rationale:
      "`K46` 使用专用规则；没有角色标注时只提示，不凭单个切片武断判断用途。",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: secondInversionTriadVoicingRule,
  }),
  defineStatelessRule({
    id: "connection.common-tone-fourth-fifth",
    catalogNumber: "I.1",
    label: "四五度关系共同音保持",
    description:
      "两个原位三和弦根音为四度或五度关系，且不存在旋律或功能例外时，检查上方声部是否保持共同音，其余声部是否采用最近进行。",
    rationale: "这是初级连接法，不得因为未保持共同音而掩盖一个实际合法连接。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["voice-exchange"],
    defaultExceptionPolicies: {
      "voice-exchange": "exempt",
    },
    evaluate: commonToneFourthFifthRule,
  }),
  defineStatelessRule({
    id: "connection.second-relation-contrary-motion",
    catalogNumber: "I.2",
    label: "二度关系反向进行",
    description:
      "两原位三和弦根音相差二度且没有共同音时，检查上三声部整体是否采用与低音相反的最近进行。",
    rationale:
      "平行五八度由 C.2/C.3 独立判断；旋律给定题可能采用其他合法配置。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: secondRelationContraryMotionRule,
  }),
  defineStatelessRule({
    id: "connection.common-tone-third",
    catalogNumber: "I.3",
    label: "三度关系共同音保持",
    description:
      "两个三和弦根音为三度关系时，提示保留共同音并使其余声部最近进行。",
    rationale: "属于基础连接方法而非绝对禁令；不得与声部交换或旋律目标冲突。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["voice-exchange"],
    defaultExceptionPolicies: {
      "voice-exchange": "exempt",
    },
    evaluate: commonToneThirdRule,
  }),
  defineStatelessRule({
    id: "connection.nonparsimonious-motion",
    catalogNumber: "I.4",
    label: "不必要的声部大幅移动",
    description:
      "连接器比较满足硬约束的候选配置；当前配置总移动代价显著高于最近进行候选时提示。",
    rationale:
      "旋律线、音域调整、同和弦转换、声部交换和后继准备均可构成合理原因；首版不应自动启用。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "same-harmony",
      "voice-exchange",
      "pedal-point",
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
      "voice-exchange": "exempt",
      "pedal-point": "exempt",
    },
    evaluate: nonparsimoniousMotionRule,
  }),
);
