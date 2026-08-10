import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
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
  connectionBoundarySlices,
  diagnostic,
  finalSameHarmonySlice,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

const UPPER_VOICES = ["soprano", "alto", "tenor"] as const;

function simplePitchClassDistance(left: number, right: number) {
  const direct = Math.abs(left - right) % 12;
  return Math.min(direct, 12 - direct);
}

function isPlainTriad(chord: NonNullable<HarmonyAnalysis["slices"][number]["chord"]>) {
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

export function incompleteSatbRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  if (!analysis.project.ruleProfile.shared.strictFourPartTexture)
    return diagnostics;

  analysis.slices.forEach((slice) => {
    if (!slice.chord || slice.completeSatb) return;
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
  });
  return diagnostics;
}

export function allVoicesSimilarRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.sliceTransitions.forEach((transition) => {
    if (
      !transition.contiguous ||
      !transition.previous.completeSatb ||
      !transition.current.completeSatb ||
      transition.changedVoiceIds.length !== VOICE_ORDER.length ||
      !VOICE_ORDER.every((voiceId) =>
        transition.current.attackVoiceIds.includes(voiceId),
      )
    )
      return;
    const directions = VOICE_ORDER.map((voiceId) => {
      const previous = transition.previous.notes[voiceId]!;
      const current = transition.current.notes[voiceId]!;
      return Math.sign(toMidi(current.pitch) - toMidi(previous.pitch));
    });
    if (directions[0] === 0 || !directions.every((item) => item === directions[0]))
      return;
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
          causeRefs: [
            `voice-leading.all-voices-similar|${transition.id}`,
          ],
          evidence: VOICE_ORDER.map((voiceId) =>
            noteEvidence(
              transition.current.notes[voiceId]!,
              `${voiceId} 当前音`,
            ),
          ),
        },
      ),
    );
  });
  return diagnostics;
}

export function triadVoicingRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "chord.triad-root-position-doubling"
    | "chord.first-inversion-doubling"
    | "chord.second-inversion-voicing",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.slices.forEach((slice, sliceIndex) => {
    const chord = slice.chord;
    if (
      !chord ||
      !slice.completeSatb ||
      finalSameHarmonySlice(analysis, sliceIndex) ||
      !isPlainTriad(chord)
    )
      return;
    const inversion = chordInversion(chord);
    if (
      (ruleId === "chord.triad-root-position-doubling" && inversion !== 0) ||
      (ruleId === "chord.first-inversion-doubling" && inversion !== 1) ||
      (ruleId === "chord.second-inversion-voicing" && inversion !== 2)
    )
      return;
    const tones = chordIdentityToneSpellings(chord.identity);
    const { active, counts } = chordToneCounts(slice, tones);
    if (counts.some((count) => count === 0)) return;

    let valid = true;
    let explanation = "";
    if (ruleId === "chord.triad-root-position-doubling") {
      if (
        chord.identity.structure.kind === "tertian" &&
        chord.identity.structure.quality === "diminished"
      )
        return;
      const leadingTone = scaleDegreePitchClass(
        slice.key,
        7,
        slice.key.mode === "minor" ? 1 : 0,
      );
      // 重复导音由更严格的 D.8 负责，避免在同一配置上再给一条教学建议。
      if (
        counts.some(
          (count, index) =>
            count > 1 && pitchClassEquals(tones[index], leadingTone),
        )
      )
        return;
      valid = counts[0] === 2;
      explanation = "完整的原位大、小三和弦通常重复根音。";
    } else if (ruleId === "chord.first-inversion-doubling") {
      const interpretation = chord.semantics
        ? primaryHarmonyInterpretation(chord.semantics)
        : undefined;
      const preferBass =
        chord.identity.structure.kind === "tertian" &&
        (chord.identity.structure.quality === "diminished" ||
          interpretation?.degree === 2);
      valid = preferBass
        ? counts[1] === 2
        : counts[0] === 2 || counts[2] === 2;
      explanation = preferBass
        ? "减三和弦或 SII6 通常重复六和弦低音。"
        : "一般六和弦优先重复根音或五音；重复三音需要明确的连接理由。";
    } else {
      const role = chord.semantics?.cadenceRole;
      valid =
        counts[2] === 2 &&
        (role === "cadential64" || role === "passing64" || role === "pedal64");
      explanation =
        "四六和弦通常重复低音，并应明确标注为终止、经过或辅助四六。";
    }
    if (valid) return;
    diagnostics.push(
      diagnostic(
        ruleId,
        slice.tick,
        slice.endTick,
        [],
        [],
        ruleId === "chord.second-inversion-voicing"
          ? "四六和弦配置缺少依据"
          : "三和弦重复音不符合常用配置",
        `${chordLabel(chord)}：${explanation}`,
        {
          chordIds: [chord.id],
          params: { counts: counts.join("/"), inversion },
          evidence: [
            chordEvidence(chord),
            ...active.map(({ note }) => noteEvidence(note, "当前配置")),
          ],
        },
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

export function basicConnectionRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "connection.common-tone-fourth-fifth"
    | "connection.second-relation-contrary-motion"
    | "connection.common-tone-third"
    | "connection.nonparsimonious-motion",
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown" ||
      connection.relation === "same-harmony"
    )
      return;
    const boundary = connectionBoundarySlices(analysis, connection);
    if (
      !boundary ||
      !boundary.source.completeSatb ||
      !boundary.target.completeSatb ||
      !isPlainTriad(boundary.source.chord!) ||
      !isPlainTriad(boundary.target.chord!) ||
      chordInversion(boundary.source.chord!) !== 0 ||
      chordInversion(boundary.target.chord!) !== 0
    )
      return;
    const sourceRoot = pitchClassValue(boundary.source.chord!.identity.root);
    const targetRoot = pitchClassValue(boundary.target.chord!.identity.root);
    const rootDistance = simplePitchClassDistance(sourceRoot, targetRoot);
    const writtenRootDirect = Math.abs(
      stepIndex(boundary.source.chord!.identity.root.step) -
        stepIndex(boundary.target.chord!.identity.root.step),
    );
    const writtenRootDistance = Math.min(
      writtenRootDirect,
      7 - writtenRootDirect,
    );
    const { common, heldVoices } = commonToneState(
      boundary.source,
      boundary.target,
    );
    const upperMotion = UPPER_VOICES.map((voiceId) => ({
      voiceId,
      semitones:
        toMidi(boundary.target.notes[voiceId]!.pitch) -
        toMidi(boundary.source.notes[voiceId]!.pitch),
    }));
    const bassMotion =
      toMidi(boundary.target.notes.bass!.pitch) -
      toMidi(boundary.source.notes.bass!.pitch);
    let matches = false;
    let title = "";
    let message = "";

    if (ruleId === "connection.common-tone-fourth-fifth") {
      if (
        rootDistance !== 5 ||
        writtenRootDistance !== 3 ||
        common.length === 0
      )
        return;
      matches = heldVoices.length === 0;
      title = "四五度关系连接未保持共同音";
      message = "两个原位三和弦相距四、五度时，通常由同一上方声部保持共同音。";
    } else if (ruleId === "connection.second-relation-contrary-motion") {
      if (
        (rootDistance !== 1 && rootDistance !== 2) ||
        writtenRootDistance !== 1 ||
        common.length > 0
      )
        return;
      const bassDirection = Math.sign(bassMotion);
      matches =
        bassDirection !== 0 &&
        upperMotion.some(
          ({ semitones }) =>
            Math.sign(semitones) !== -bassDirection || Math.abs(semitones) > 4,
        );
      title = "二度关系连接未采用反向最近进行";
      message = "无共同音的二度关系三和弦，通常让上三声部与低音反向并采用最近进行。";
    } else if (ruleId === "connection.common-tone-third") {
      if (
        (rootDistance !== 3 && rootDistance !== 4) ||
        writtenRootDistance !== 2 ||
        common.length < 2
      )
        return;
      matches = heldVoices.length < 2;
      title = "三度关系连接未充分保持共同音";
      message = "三度关系三和弦通常保持两个共同音，仅移动其余声部。";
    } else {
      const totalMotion = upperMotion.reduce(
        (sum, item) => sum + Math.abs(item.semitones),
        0,
      );
      const largeMovers = upperMotion.filter(
        ({ semitones }) => Math.abs(semitones) > 4,
      );
      const failedCommonTone = common.length > 0 && heldVoices.length === 0;
      matches =
        largeMovers.length >= 2 &&
        totalMotion >= 12 &&
        (failedCommonTone || totalMotion >= 16);
      title = "存在不必要的大幅声部移动";
      message = `当前上三声部总移动 ${totalMotion} 个半音，且多个声部进行了可避免的大幅移动。`;
    }
    if (!matches) return;
    const notes = VOICE_ORDER.flatMap((voiceId) => [
      boundary.source.notes[voiceId]!,
      boundary.target.notes[voiceId]!,
    ]);
    diagnostics.push(
      diagnostic(
        ruleId,
        boundary.target.tick,
        boundary.target.endTick,
        [...UPPER_VOICES] as VoiceId[],
        notes,
        title,
        message,
        {
          chordIds: [boundary.source.chord!.id, boundary.target.chord!.id],
          params: {
            rootDistance,
            commonTones: common.length,
            heldCommonTones: heldVoices.length,
          },
          causeRefs: [`${ruleId}|${connection.connectionKey}`],
          evidence: [
            chordEvidence(boundary.source.chord!),
            chordEvidence(boundary.target.chord!),
          ],
        },
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
    description: "在启用“严格四声部习题”profile 且和弦区间要求完整配置时，任一 SATB 声部没有有效音符即触发。",
    rationale: "弱起、分句休止、导入后的未完成片段和自由写作 profile 默认不检查。",
    group: "voice",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "slice",
    evaluate: incompleteSatbRule,
  }),
  defineStatelessRule({
    id: "voice-leading.all-voices-similar",
    catalogNumber: "C.9",
    label: "四声部同向进行",
    description: "相邻结构切片中四个 SATB 声部全部实际起奏并向同一方向移动时提示。",
    rationale: "本条只评价织体独立性；若同时产生平行五八度，只显示更具体的平行诊断为主。",
    group: "voiceLeading",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "slice",
    evaluate: allVoicesSimilarRule,
  }),
  defineStatelessRule({
    id: "chord.triad-root-position-doubling",
    catalogNumber: "D.5",
    label: "原位三和弦重复音",
    description: "完整四声部原位三和弦通常应重复根音；重复三音或省略必要构成音时根据和弦级数、调式和连接语境提示。",
    rationale: "不得与“重复导音”等硬限制重复报警；具体副三和弦允许的重复方式需由 voicing profile 给出。",
    group: "chord",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "chord",
    evaluate: (analysis) =>
    triadVoicingRule(analysis, "chord.triad-root-position-doubling"),
  }),
  defineStatelessRule({
    id: "chord.first-inversion-doubling",
    catalogNumber: "D.6",
    label: "六和弦重复音",
    description: "根据具体功能和级数选择允许/优先的重复音；导音、变化音和不稳定三音不得因一般“自由重复”而被重复。",
    rationale: "`SII6`、减三和弦、经过六和弦等必须使用各自 profile，不能用一条“所有六和弦都重复低音”的简化规则。",
    group: "chord",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "chord",
    evaluate: (analysis) =>
    triadVoicingRule(analysis, "chord.first-inversion-doubling"),
  }),
  defineStatelessRule({
    id: "chord.second-inversion-voicing",
    catalogNumber: "D.7",
    label: "四六和弦配置",
    description: "检查低音是否为五音、通常是否重复低音，以及该四六和弦是否具有终止、经过、辅助或持续低音等可解释语境。",
    rationale: "`K46` 使用专用规则；没有角色标注时只提示，不凭单个切片武断判断用途。",
    group: "chord",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords"
    ],
    dependencyScope: "chord",
    evaluate: (analysis) =>
    triadVoicingRule(analysis, "chord.second-inversion-voicing"),
  }),
  defineStatelessRule({
    id: "connection.common-tone-fourth-fifth",
    catalogNumber: "I.1",
    label: "四五度关系共同音保持",
    description: "两个原位三和弦根音为四度或五度关系，且不存在旋律或功能例外时，检查上方声部是否保持共同音，其余声部是否采用最近进行。",
    rationale: "这是初级连接法，不得因为未保持共同音而掩盖一个实际合法连接。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "voice-exchange"
    ],
    defaultExceptionPolicies: {
      "voice-exchange": "exempt"
    },
    evaluate: (analysis) =>
    basicConnectionRule(analysis, "connection.common-tone-fourth-fifth"),
  }),
  defineStatelessRule({
    id: "connection.second-relation-contrary-motion",
    catalogNumber: "I.2",
    label: "二度关系反向进行",
    description: "两原位三和弦根音相差二度且没有共同音时，检查上三声部整体是否采用与低音相反的最近进行。",
    rationale: "平行五八度由 C.2/C.3 独立判断；旋律给定题可能采用其他合法配置。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: (analysis) =>
    basicConnectionRule(
      analysis,
      "connection.second-relation-contrary-motion",
    ),
  }),
  defineStatelessRule({
    id: "connection.common-tone-third",
    catalogNumber: "I.3",
    label: "三度关系共同音保持",
    description: "两个三和弦根音为三度关系时，提示保留共同音并使其余声部最近进行。",
    rationale: "属于基础连接方法而非绝对禁令；不得与声部交换或旋律目标冲突。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "voice-exchange"
    ],
    defaultExceptionPolicies: {
      "voice-exchange": "exempt"
    },
    evaluate: (analysis) =>
    basicConnectionRule(analysis, "connection.common-tone-third"),
  }),
  defineStatelessRule({
    id: "connection.nonparsimonious-motion",
    catalogNumber: "I.4",
    label: "不必要的声部大幅移动",
    description: "连接器比较满足硬约束的候选配置；当前配置总移动代价显著高于最近进行候选时提示。",
    rationale: "旋律线、音域调整、同和弦转换、声部交换和后继准备均可构成合理原因；首版不应自动启用。",
    group: "connection",
    defaultSeverity: "suggestion",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "same-harmony",
      "voice-exchange",
      "pedal-point"
    ],
    defaultExceptionPolicies: {
      "same-harmony": "exempt",
      "voice-exchange": "exempt",
      "pedal-point": "exempt"
    },
    evaluate: (analysis) =>
    basicConnectionRule(analysis, "connection.nonparsimonious-motion"),
  }),
);
