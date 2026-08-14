import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  harmonySemanticsCompatibleWithIdentity,
} from "../../../chordModel";
import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import {
  formatPitchClass,
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordLabel,
  diagnostic,
  hasExactPitch,
  noteEvidence,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

interface ChordSliceFact {
  slice: HarmonyAnalysis["slices"][number];
  chord: NonNullable<HarmonyAnalysis["slices"][number]["chord"]>;
  active: ReturnType<typeof activeNotes>;
  tones: ReturnType<typeof chordIdentityToneSpellings>;
  stableComplete: boolean;
}

function chordSliceFacts(context: HarmonyRuleContext) {
  return context
    .slices()
    .selectMany((slice): ChordSliceFact[] => {
      if (!slice.chord) return [];
      return [
        {
          slice,
          chord: slice.chord,
          active: activeNotes(slice),
          tones: chordIdentityToneSpellings(slice.chord.identity),
          stableComplete:
            slice.completeSatb &&
            !context.sliceTransitions({ fromSliceIndex: slice.index }).first()
              ?.sameHarmony,
        },
      ];
    })
    .toArray();
}

function standardChordSliceFacts(context: HarmonyRuleContext) {
  return chordSliceFacts(context).filter(
    ({ chord }) =>
      chord.identity.structure.kind === "tertian" &&
      !chord.identity.structure.extensions.some(
        (extension) => extension >= 9,
      ),
  );
}

export function unclassifiedNonchordToneRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  standardChordSliceFacts(context).forEach(
    ({ slice, chord, active, tones }) => {
      const outside = active.filter(
        ({ note }) => !note.nonChordToneRole && !hasExactPitch(note, tones),
      );
      if (outside.length === 0) return;
      diagnostics.push(
        diagnostic(
          "chord.unclassified-nonchord-tone",
          slice.tick,
          slice.endTick,
          outside.map((item) => item.voiceId),
          outside.map((item) => item.note),
          "和弦外音需要确认",
          `标注和弦 ${chordLabel(chord)} 中存在拼写不属于和弦构成音、且未人工标注角色的音符。`,
          {
            chordIds: [chord.id],
            evidence: [
              chordEvidence(chord),
              ...outside.map((item) => noteEvidence(item.note)),
            ],
          },
        ),
      );
    },
  );
  return diagnostics;
}

export function inversionBassRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  standardChordSliceFacts(context).forEach(({ slice, chord, active }) => {
    const bass = active.find((item) => item.voiceId === "bass");
    if (!bass || pitchClassEquals(bass.note.pitch, chord.identity.bass)) return;
    diagnostics.push(
      diagnostic(
        "chord.inversion-bass",
        slice.tick,
        slice.endTick,
        ["bass"],
        [bass.note],
        "低音与转位不一致",
        `${chordLabel(chord)} 要求低音写作 ${formatPitchClass(chord.identity.bass)}，当前为 ${formatPitchClass(bass.note.pitch)}。`,
        {
          chordIds: [chord.id],
          evidence: [chordEvidence(chord), noteEvidence(bass.note, "男低音")],
        },
      ),
    );
  });
  return diagnostics;
}

export function incompleteChordMembersRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  standardChordSliceFacts(context).forEach(
    ({ slice, chord, active, tones, stableComplete }) => {
      if (!stableComplete) return;
      const missing = tones.filter(
        (tone) =>
          !active.some(({ note }) => pitchClassEquals(note.pitch, tone)),
      );
      if (missing.length === 0) return;
      diagnostics.push(
        diagnostic(
          "chord.incomplete-members",
          slice.tick,
          slice.endTick,
          [],
          [],
          "和弦构成音不完整",
          `${chordLabel(chord)} 缺少 ${missing.map(formatPitchClass).join("、")}。`,
          {
            chordIds: [chord.id],
            params: { missing: missing.map(formatPitchClass).join(",") },
            evidence: [
              chordEvidence(chord),
              {
                kind: "chord",
                id: chord.id,
                label: "缺少构成音",
                value: missing.map(formatPitchClass).join("、"),
              },
            ],
          },
        ),
      );
    },
  );
  return diagnostics;
}

interface RepeatedChordTonePolicy {
  id: "chord.doubled-leading-tone" | "chord.doubled-seventh";
  target(fact: ChordSliceFact): SpelledPitchClass | undefined;
  title: string;
  message(chord: ChordSliceFact["chord"], target: SpelledPitchClass): string;
}

function evaluateRepeatedChordToneRule(
  context: HarmonyRuleContext,
  policy: RepeatedChordTonePolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  standardChordSliceFacts(context).forEach((fact) => {
    if (!fact.stableComplete) return;
    const target = policy.target(fact);
    if (!target) return;
    const repeated = fact.active.filter(({ note }) =>
      pitchClassEquals(note.pitch, target),
    );
    if (repeated.length <= 1) return;
    diagnostics.push(
      diagnostic(
        policy.id,
        fact.slice.tick,
        fact.slice.endTick,
        repeated.map((item) => item.voiceId),
        repeated.map((item) => item.note),
        policy.title,
        policy.message(fact.chord, target),
        {
          chordIds: [fact.chord.id],
          evidence: [
            chordEvidence(fact.chord),
            ...repeated.map((item) => noteEvidence(item.note)),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function doubledLeadingToneRule(context: HarmonyRuleContext) {
  return evaluateRepeatedChordToneRule(context, {
    id: "chord.doubled-leading-tone",
    target: ({ slice }) => leadingTonePitchClass(slice.key),
    title: "重复导音",
    message: (_chord, target) =>
      `四部和声中通常不应重复局部调性内的书写导音 ${formatPitchClass(target)}。`,
  });
}

export function doubledSeventhRule(context: HarmonyRuleContext) {
  return evaluateRepeatedChordToneRule(context, {
    id: "chord.doubled-seventh",
    target: ({ tones }) => (tones.length === 4 ? tones[3] : undefined),
    title: "重复和弦七音",
    message: (chord, target) =>
      `${chordLabel(chord)} 的七音 ${formatPitchClass(target)} 不应重复。`,
  });
}

export function doubledAlteredTendencyToneRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  chordSliceFacts(context).forEach(
    ({ slice, chord, active, stableComplete }) => {
      if (!stableComplete || chord.identity.structure.kind !== "tertian")
        return;
      const directionalTones: Array<{
        tone: SpelledPitchClass;
        tendency: "up" | "down";
        degree: number;
      }> = [];
      chord.identity.structure.alterations.forEach((alteration) => {
        if (!alteration.tendency) return;
        const tone = chordIdentityToneSpellingForDegree(
          chord.identity,
          alteration.degree,
        );
        if (tone)
          directionalTones.push({
            tone,
            tendency: alteration.tendency,
            degree: alteration.degree,
          });
      });
      const resolution = context.harmony.primaryInterpretation(chord);
      const interpretation =
        resolution.status === "resolved" ? resolution.value : undefined;
      const designationKind = interpretation?.designation?.kind;
      const targetDegree =
        interpretation?.appliedTarget?.degree ??
        (designationKind === "double-dominant" ||
        designationKind === "double-dominant-leading-tone"
          ? 5
          : undefined);
      if (targetDegree) {
        const targetTonic = scaleDegreePitchClass(slice.key, targetDegree, 0);
        const targetLeadingTone = leadingTonePitchClass({
          tonic: targetTonic,
          mode: "major",
        });
        if (
          chordIdentityToneSpellings(chord.identity).some((tone) =>
            pitchClassEquals(tone, targetLeadingTone),
          ) &&
          !directionalTones.some(({ tone }) =>
            pitchClassEquals(tone, targetLeadingTone),
          )
        )
          directionalTones.push({
            tone: targetLeadingTone,
            tendency: "up",
            degree: 7,
          });
      }
      directionalTones.forEach(({ tone, tendency, degree }) => {
        const repeated = active.filter(({ note }) =>
          pitchClassEquals(note.pitch, tone),
        );
        if (repeated.length <= 1) return;
        diagnostics.push(
          diagnostic(
            "chord.doubled-altered-tendency-tone",
            slice.tick,
            slice.endTick,
            [],
            [],
            "重复变化倾向音",
            `${chordLabel(chord)} 的 ${formatPitchClass(tone)} 具有明确的${tendency === "up" ? "上行" : "下行"}倾向，不应重复。`,
            {
              chordIds: [chord.id],
              params: { degree, tendency, count: repeated.length },
              evidence: [
                chordEvidence(chord),
                ...repeated.map(({ note }) =>
                  noteEvidence(note, "重复变化倾向音"),
                ),
              ],
            },
          ),
        );
      });
    },
  );
  return diagnostics;
}

function dominantNinthFacts(context: HarmonyRuleContext) {
  return chordSliceFacts(context).filter(
    ({ chord, stableComplete }) =>
      stableComplete &&
      chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.quality === "dominant7" &&
      chord.identity.structure.extensions.includes(9),
  );
}

export function dominantNinthVoicingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  dominantNinthFacts(context).forEach(({ slice, chord, active, tones }) => {
    const counts = tones.map(
      (tone) =>
        active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
    );
    const required = chordVoicingPolicy(chord.identity).requiredDegrees;
    const missing = required
      .map((degree) => {
        const index =
          degree === 1
            ? 0
            : degree === 3
              ? 1
              : degree === 5
                ? 2
                : degree === 7
                  ? 3
                  : 4;
        return counts[index] === 0 ? tones[index] : undefined;
      })
      .filter((tone): tone is SpelledPitchClass => Boolean(tone));
    const fifthPresent = counts[2] > 0;
    if (missing.length === 0 && !fifthPresent) return;
    const problems = [
      ...(missing.length > 0
        ? [`缺少 ${missing.map(formatPitchClass).join("、")}`]
        : []),
      ...(fifthPresent ? ["不应出现五音"] : []),
    ];
    diagnostics.push(
      diagnostic(
        "chord.dominant-ninth-voicing",
        slice.tick,
        slice.endTick,
        [],
        [],
        "属九和弦配置不符合四声部要求",
        `${chordLabel(chord)} ${problems.join("，")}。四声部 D9 默认采用 1/3/7/9。`,
        {
          chordIds: [chord.id],
          params: {
            missing: missing.map(formatPitchClass).join(","),
            fifthPresent,
          },
          evidence: [chordEvidence(chord)],
        },
      ),
    );
  });
  return diagnostics;
}

export function dominantNinthRootSpacingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  dominantNinthFacts(context).forEach(({ slice, chord, active, tones }) => {
    const root = active.find(
      ({ voiceId, note }) =>
        voiceId === "bass" && pitchClassEquals(note.pitch, tones[0]),
    );
    const ninth = active.find(({ note }) =>
      pitchClassEquals(note.pitch, tones[4]),
    );
    const minimumSemitones = 12;
    if (!root || !ninth) return;
    const interval = writtenInterval(root.note.pitch, ninth.note.pitch);
    if (interval.semitones > minimumSemitones && interval.diatonicSteps >= 8)
      return;
    diagnostics.push(
      diagnostic(
        "chord.dominant-ninth-root-spacing",
        slice.tick,
        slice.endTick,
        ["bass"],
        [root.note, ninth.note],
        "属九和弦根音与九音间距不足",
        `${chordLabel(chord)} 的九音必须位于根音上方超过八度。`,
        {
          chordIds: [chord.id],
          params: {
            distance: interval.semitones,
            diatonicSteps: interval.diatonicSteps,
            minimumSemitones,
          },
          evidence: [
            chordEvidence(chord),
            noteEvidence(root.note, "根音"),
            noteEvidence(ninth.note, "九音"),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function augmentedSixthVoicingRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  chordSliceFacts(context).forEach(
    ({ slice, chord, active, tones, stableComplete }) => {
      if (
        !stableComplete ||
        chord.identity.structure.kind !== "augmented-sixth"
      )
        return;
      const expected =
        chord.identity.structure.variant === "italian"
          ? [1, 2, 1]
          : [1, 1, 1, 1];
      const counts = tones.map(
        (tone) =>
          active.filter(({ note }) => pitchClassEquals(note.pitch, tone))
            .length,
      );
      if (counts.every((count, index) => count === expected[index])) return;
      const variantLabel =
        chord.identity.structure.variant === "italian"
          ? "It+6"
          : chord.identity.structure.variant === "french"
            ? "Fr+6"
            : "Ger+6";
      diagnostics.push(
        diagnostic(
          "chord.augmented-sixth-voicing",
          slice.tick,
          slice.endTick,
          [],
          [],
          "增六和弦配置不正确",
          `${variantLabel} 应按 ${expected.join("/")} 配置 ${tones.map(formatPitchClass).join("、")}；增六两端变化音必须各出现一次。`,
          {
            chordIds: [chord.id],
            params: {
              variant: variantLabel,
              expected: expected.join("/"),
              actual: counts.join("/"),
            },
            evidence: [
              chordEvidence(chord),
              ...active.map(({ note }) => noteEvidence(note, "当前配置")),
            ],
          },
        ),
      );
    },
  );
  return diagnostics;
}

/**
 * 正常调色盘和编辑命令会阻止语义与实体分叉；这里仍在规则层做一次防御检查，
 * 以覆盖迁移、外置工具或未经过命令层写入的工程数据。
 */
export function chordInterpretationIdentityRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  analysis.project.chordTrack.regions.forEach((chord) => {
    if (!chord.semantics) return;
    const key = context.keyAt(chord.startTick);
    if (!key) return;
    if (
      harmonySemanticsCompatibleWithIdentity(
        chord.identity,
        chord.semantics,
        key,
      )
    )
      return;
    const resolution = context.harmony.primaryInterpretation(chord);
    const interpretations =
      resolution.status === "resolved"
        ? [resolution.value]
        : resolution.status === "ambiguous"
          ? resolution.candidates
          : [];
    diagnostics.push(
      diagnostic(
        "chord.interpretation-identity-conflict",
        chord.startTick,
        chord.startTick + chord.durationTicks,
        [],
        [],
        "功能解释与和弦实体冲突",
        `${chordLabel(chord)} 的和声解释无法重新生成当前根音、结构或低音。`,
        {
          chordIds: [chord.id],
          params: {
            interpretationIds: interpretations.map((item) => item.id).join(","),
            degrees: interpretations.map((item) => item.degree).join(","),
          },
          evidence: [
            chordEvidence(chord),
            {
              kind: "function",
              label: interpretations.length > 1 ? "候选解释" : "和声解释",
              value: interpretations
                .map(
                  (item) =>
                    item.designation?.kind ?? `第 ${item.degree} 级`,
                )
                .join(" / "),
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export const CHORD_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "chord.unclassified-nonchord-tone",
    catalogNumber: "D.1",
    label: "未标注的和弦外音",
    description:
      "按实际书写音高与当前 `ChordIdentity` 比较；音符不属于构成音集合且没有人工确认角色时触发。",
    rationale:
      "持续低音、经过音等只有在角色得到确认后豁免；和弦区域没有可靠 identity 时跳过。",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    supportedExceptionContexts: ["nonchord-tone", "pedal-point"],
    evaluate: unclassifiedNonchordToneRule,
  }),
  defineStatelessRule({
    id: "chord.incomplete-members",
    catalogNumber: "D.2",
    label: "和弦构成音不完整",
    description:
      "在同和弦 span 的最后一个完整有效切片，对照 `ChordVoicingPolicy.requiredDegrees` 检查缺失成员。",
    rationale:
      "允许省略的和弦音不触发；span 中间转换暂不检查；诊断只归属和弦轨。",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: incompleteChordMembersRule,
  }),
  defineStatelessRule({
    id: "chord.inversion-bass",
    catalogNumber: "D.3",
    label: "低音与转位不一致",
    description:
      "在每个有完整低音的切片中，将男低音书写音高映射到 identity degree，并与和弦转位比较。",
    rationale:
      "已确认的持续低音语境由踏板规则接管；无法映射为和弦音时同时属于 D.1，但只保留更具体根因。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: inversionBassRule,
  }),
  defineStatelessRule({
    id: "chord.interpretation-identity-conflict",
    catalogNumber: "D.4",
    label: "功能标记与和弦实体冲突",
    description:
      "用局部调性和 `FunctionalDesignation` 重新生成规范 identity，与持久化 identity 的书写构成、低音约束和结构类别比较。",
    rationale:
      "正常编辑命令应提前阻止该状态；本规则用于导入、迁移、外置工具或损坏数据后的防御诊断。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["chords", "semantics"],
    dependencyScope: "chord",
    evaluate: chordInterpretationIdentityRule,
  }),
  defineStatelessRule({
    id: "chord.doubled-leading-tone",
    catalogNumber: "D.8",
    label: "重复导音",
    description:
      "在 span 出口或独立和弦的最后有效配置中，按 `SpelledPitch` 和局部调性识别导音并计数。",
    rationale:
      "span 中间的暂时重复延迟判断；共同和弦歧义时只使用已确认局部调性。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: doubledLeadingToneRule,
  }),
  defineStatelessRule({
    id: "chord.doubled-seventh",
    catalogNumber: "D.9",
    label: "重复和弦七音",
    description:
      "在稳定配置中按 identity degree 识别七音，出现两个或更多时触发。",
    rationale:
      "同和弦转换中间切片延迟判断；人工装饰音不能被误算为第二个和弦七音。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: doubledSeventhRule,
  }),
  defineStatelessRule({
    id: "chord.doubled-altered-tendency-tone",
    catalogNumber: "D.10",
    label: "重复变化倾向音",
    description:
      "根据和弦 identity 和功能目标识别带方向性的变化构成音，稳定配置中重复该音时触发。",
    rationale:
      "必须读取结构化 alteration，不能把所有调外音都当作倾向音；具体和弦可覆盖默认策略。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: doubledAlteredTendencyToneRule,
  }),
  defineStatelessRule({
    id: "chord.dominant-ninth-voicing",
    catalogNumber: "D.11",
    label: "D9 四声部配置",
    description:
      "四声部 `D9` 必须恰好实现项目已审定的 `1/3/7/9` 配置；缺少必需音或出现五音时触发。",
    rationale:
      "仅适用于本项目支持的原位 `D9`；未来扩展五声部或其他九和弦时不得复用该固定策略。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: dominantNinthVoicingRule,
  }),
  defineStatelessRule({
    id: "chord.dominant-ninth-root-spacing",
    catalogNumber: "D.12",
    label: "D9 根音与九音间距",
    description:
      "在当前支持的原位四声部 `D9` 中，定位唯一根音与九音；九音实际音高必须高于根音 12 个半音以上，并在书写上形成复九度而不是同一八度内的二度。",
    rationale:
      "当前 `D9` 固定根音位于男低音且配置为 `1/3/7/9`；如果未来支持省略根音、多个根音、转位九和弦或五声部配置，必须为新结构单独定义策略。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: dominantNinthRootSpacingRule,
  }),
  defineStatelessRule({
    id: "chord.augmented-sixth-voicing",
    catalogNumber: "D.13",
    label: "增六和弦配置",
    description:
      "分别按 It+6、Fr+6、Ger+6 的规范书写构成检查，确保增六两端音存在且不重复具有强烈解决方向的变化音。",
    rationale:
      "三种结构不能只按 pitch class 合并；具体允许重复成员需建立调性金样本。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: augmentedSixthVoicingRule,
  }),
);
