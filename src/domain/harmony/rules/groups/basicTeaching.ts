import {
  chordIdentityToneSpellings,
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
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { notesWithAnticipationReplacements } from "../helpers/anticipation";
import { leadingToneForFunction } from "../services/harmony";
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
  active: ReturnType<typeof activeNotes>,
  tones: ReturnType<typeof chordIdentityToneSpellings>,
) {
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
      const sounding = activeNotes(slice);
      const { active, counts } = chordToneCounts(
        inversion === 0
          ? notesWithAnticipationReplacements(context, slice, sounding)
          : sounding,
        tones,
      );
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
        ...fact.active.map(({ note }) =>
          noteEvidence(note, note.startTick + note.durationTicks <= fact.slice.tick
            ? "先现前的结构音"
            : "当前配置"),
        ),
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
    const resolution = context.harmony.primaryInterpretation(fact.chord);
    const { tone: leadingTone } = leadingToneForFunction(
      fact.slice.key,
      resolution.status === "resolved" ? resolution.value : undefined,
    );
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
    const bassDirection = Math.sign(fact.bassMotion);
    const isMelodicConnection =
      bassDirection !== 0 &&
      fact.upperMotion.every(
        ({ semitones }) =>
          Math.sign(semitones) === -bassDirection && Math.abs(semitones) <= 4,
      );
    if (isMelodicConnection) return;
    diagnostics.push(
      basicConnectionDiagnostic(
        fact,
        "connection.common-tone-fourth-fifth",
        "四五度关系连接未保持共同音",
        "两个原位三和弦相距四、五度时，通常由同一上方声部保持共同音或使用规范旋律连接法。",
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
      "检查在严格四部和声写作中各声部是否均有有效发音。",
    rationale:
      "严格四部和声练习要求 SATB 四个声部自始至终保持连续发声与织体丰满，无特殊声部减缩或休息设计时不应出现声部缺位。",
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
      "检查四个声部是否在同一时刻全部向同一方向（全部上行或全部下行）运动。",
    rationale:
      "声部独立性的最高原则是动向对比。四个声部全部同向运动会使整个和声织体出现“全体倾斜”，破坏多声部多向交织的张力平衡与独立性。通常应保持低音与上方声部形成反向或斜向进行。",
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
      "检查原位大/小三和弦是否按照标准规范重复根音。",
    rationale:
      "原位正三和弦（Ⅰ、Ⅳ、Ⅴ）的根音是和弦的稳定支柱，四部和声中首选重复根音以强化和声功能；三音具有鲜明的色彩感，非特定连接（如 Ⅵ 级阻碍进行）一般不重复三音，以免和弦色彩过浓或引发平行进行。",
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
      "检查第一转位（六和弦）的重复音选择是否符合功能与调式规范。",
    rationale:
      "六和弦低音为三音，具有较强的旋律流动性。通常首选重复根音或五音（主调体系的稳定主干音），避免重复正三和弦的三音（特别是 Ⅴ6 的三音即导音）；在 Ⅱ6 等副三和弦六和弦中则允许重复低音（下属音）。",
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
      "检查第二转位（四六和弦）是否重复五音（低音）并符合规范的结构语境。",
    rationale:
      "四六和弦低音为五音，与上方声部构成不稳定的四度音程，因此四六和弦本身不具备独立功能，主要作为经过、辅助或终止四六使用。四声部中必须重复其低音（五音），以强化其低音线条的依托。",
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
      "检查四五度根音关系的三和弦连接是否采用和声连接法保持共同音。",
    rationale:
      "根音相距四、五度的两个三和弦包含一个共同音。采用和声连接法时，将共同音保持在同一声部，其余两个上方声部以级进或小跳移至最近的和弦音，能确保声部进行最平稳、最连贯，有效避免平行五八度。",
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
      "检查二度根音关系（无共同音）的三和弦连接中，上三声部是否与低音呈反向进行。",
    rationale:
      "根音相距二度的三和弦（如 Ⅳ-Ⅴ、Ⅴ-Ⅵ）完全没有共同音。如果低音与上方声部同向移动，极易形成连续的平行五度和平行八度。因此，古典和声规范要求上三声部必须全体与低音声部呈反向进行，走最近路线。",
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
      "检查三度根音关系的三和弦连接是否保持了两个共同音。",
    rationale:
      "根音相距三度的三和弦拥有两个共同音，和声亲缘关系极近。将两个共同音保持在原有声部、另一声部走级进，是实现平滑和声过渡与色彩柔和变化的经典连接范式。",
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
      "检查在和弦连接中声部是否违背了“平稳进行与最近路线”原则而发生多余的大幅跳跃。",
    rationale:
      "古典和声声部进行的基本法则是“省力法则（Law of Shortest Way）”——除非有明确的旋律构思或声部排列法转换需求，各声部应优先选择保持同音、半音级进、全音级进或三度小跳，避免无理由的大幅跳动破坏织体连贯性。",
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
