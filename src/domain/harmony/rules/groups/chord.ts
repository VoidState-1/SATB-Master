import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  harmonySemanticsCompatibleWithIdentity,
} from "../../../chordModel";
import type { AnalysisNote, HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { effectiveFunctionalDesignation } from "../../../functionalHarmonyCatalog";
import {
  formatPitchClass,
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
  stepIndex,
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
import { notesWithAnticipationReplacements } from "../helpers/anticipation";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";
import { leadingToneForFunction } from "../services/harmony";
import { resolvesDominantSixthSubstitution } from "./dominantSixthSubstitution";

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
      if (outside.length === 1 && outside[0].voiceId === "soprano" &&
          resolvesDominantSixthSubstitution(slice, context.sliceAt(slice.endTick))) return;
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

function connectsStructuralBasses(
  context: HarmonyRuleContext,
  chord: ChordSliceFact["chord"],
  bass: AnalysisNote,
) {
  const role = bass.nonChordToneRole;
  if ((role !== "passing" && role !== "anticipation") || context.harmony.isWrittenChordTone(bass, chord)) return false;
  const position = context.metric.positionAt(bass.startTick);
  if (!position || position.role === "downbeat" ||
      context.metric.positionAt(bass.startTick + bass.durationTicks - 1)?.measureNumber !== position.measureNumber) return false;
  const view = context.notes({ voiceId: "bass", startingAt: bass.startTick }).first(item => item.note.id === bass.id);
  const neighbors = view && context.noteNeighborhood(view);
  const previous = neighbors?.previous?.note;
  const next = neighbors?.next?.note;
  if (!previous || !next || previous.nonChordToneRole || next.nonChordToneRole ||
      previous.startTick + previous.durationTicks !== bass.startTick ||
      bass.startTick + bass.durationTicks !== next.startTick ||
      bass.durationTicks > previous.durationTicks ||
      previous.startTick < chord.startTick || next.startTick !== chord.startTick + chord.durationTicks) return false;
  const target = context.sliceAt(next.startTick)?.chord;
  if (!target || target.startTick !== next.startTick ||
      !pitchClassEquals(previous.pitch, chord.identity.bass) ||
      !pitchClassEquals(next.pitch, target.identity.bass) ||
      !context.harmony.isWrittenChordTone(previous, chord) || !context.harmony.isWrittenChordTone(next, target)) return false;
  if (role === "anticipation") {
    const landing = context.metric.positionAt(next.startTick);
    return bass.durationTicks <= next.durationTicks &&
      position.confidence === "certain" && landing?.confidence === "certain" &&
      (position.role === "weak-beat" || position.role === "subdivision") && landing.level > position.level &&
      context.pitch.sameWrittenPitch(bass, next);
  }
  const meaning = context.harmony.primaryInterpretation(chord);
  if (meaning.status === "ambiguous") return false;
  const key = (meaning.status === "resolved" && meaning.value.localKey) || context.keyAt(bass.startTick);
  if (!key) return false;
  const degree = (stepIndex(bass.pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
  if (!pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, degree))) return false;
  const entry = writtenInterval(previous.pitch, bass.pitch);
  const exit = writtenInterval(bass.pitch, next.pitch);
  return isWrittenStep(entry) && isWrittenStep(exit) &&
    entry.diatonicSteps === exit.diatonicSteps &&
    Math.sign(entry.semitones) === entry.diatonicSteps && Math.sign(exit.semitones) === exit.diatonicSteps;
}

export function inversionBassRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  standardChordSliceFacts(context).forEach(({ slice, chord, active }) => {
    const bass = active.find((item) => item.voiceId === "bass");
    if (!bass || pitchClassEquals(bass.note.pitch, chord.identity.bass)) return;
    if (connectsStructuralBasses(context, chord, bass.note)) return;
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
  const fullCadenceTargets = new Set<string>();
  for (const cadence of context.cadences({ kind: "full" })) {
    if (cadence.annotation?.stale) continue;
    const targetChord = cadence.spans.at(-1)?.lastSlice.chord;
    if (targetChord) fullCadenceTargets.add(targetChord.id);
  }
  standardChordSliceFacts(context).forEach(
    ({ slice, chord, active, stableComplete }) => {
      if (!stableComplete) return;
      const structural = notesWithAnticipationReplacements(context, slice, active);
      const requiredDegrees = chordVoicingPolicy(chord.identity).requiredDegrees;
      const missing = requiredDegrees
        .map((degree) => chordIdentityToneSpellingForDegree(chord.identity, degree))
        .filter(
          (tone): tone is SpelledPitchClass => {
            if (!tone) return false;
            return !structural.some(({ note }) => pitchClassEquals(note.pitch, tone));
          },
        );
      if (missing.length === 0) return;
      const interpretation = context.harmony.primaryInterpretation(chord);
      const functionalDesignation =
        interpretation.status === "resolved"
          ? effectiveFunctionalDesignation(
              chord.semantics!,
              chord.identity.structure.kind === "tertian"
                ? chord.identity.structure.quality
                : undefined,
            )
          : undefined;
      const isCadentialTonicFifthOmission =
        missing.length === 1 &&
        chord.identity.structure.kind === "tertian" &&
        (chord.identity.structure.quality === "major" ||
          chord.identity.structure.quality === "minor") &&
        chord.identity.structure.extensions.length === 0 &&
        chord.identity.structure.alterations.length === 0 &&
        pitchClassEquals(chord.identity.bass, chord.identity.root) &&
        fullCadenceTargets.has(chord.id) &&
        interpretation.status === "resolved" &&
        interpretation.value.degree === 1 &&
        functionalDesignation?.primaryFunction === "tonic" &&
        pitchClassEquals(
          missing[0],
          chordIdentityToneSpellingForDegree(chord.identity, 5)!,
        );
      if (isCadentialTonicFifthOmission) return;
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
  target(fact: ChordSliceFact): { tone: SpelledPitchClass; applied?: boolean } | undefined;
  title: string;
  message(chord: ChordSliceFact["chord"], target: SpelledPitchClass): string;
}

function repeatedTendencyCause(
  { slice, chord }: ChordSliceFact,
  tone: SpelledPitchClass,
  repeated: ChordSliceFact["active"],
) {
  const subjects = repeated.map(({ voiceId, note }) => `${voiceId}:${note.id}`).sort();
  return `repeated-tendency-tone|${chord.id}|${slice.tick}-${slice.endTick}|${formatPitchClass(tone)}|${subjects.join(",")}`;
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
    const { tone, applied } = target;
    const repeated = fact.active.filter(({ note }) => pitchClassEquals(note.pitch, tone));
    if (repeated.length <= 1) return;
    diagnostics.push(
      diagnostic(
        policy.id,
        fact.slice.tick,
        fact.slice.endTick,
        repeated.map((item) => item.voiceId),
        repeated.map((item) => item.note),
        policy.title,
        policy.message(fact.chord, tone),
        {
          chordIds: [fact.chord.id],
          ...(applied ? { causeRefs: [repeatedTendencyCause(fact, tone, repeated)] } : {}),
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
    target: ({ slice, chord }) => {
      const resolution = context.harmony.primaryInterpretation(chord);
      const interpretation = resolution.status === "resolved" ? resolution.value : undefined;
      return leadingToneForFunction(slice.key, interpretation);
    },
    title: "重复导音",
    message: (_chord, target) =>
      `四部和声中通常不应重复局部调性内的书写导音 ${formatPitchClass(target)}。`,
  });
}

export function doubledSeventhRule(context: HarmonyRuleContext) {
  return evaluateRepeatedChordToneRule(context, {
    id: "chord.doubled-seventh",
    target: ({ tones }) => (tones.length === 4 ? { tone: tones[3] } : undefined),
    title: "重复和弦七音",
    message: (chord, target) =>
      `${chordLabel(chord)} 的七音 ${formatPitchClass(target)} 不应重复。`,
  });
}

export function doubledAlteredTendencyToneRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  chordSliceFacts(context).forEach(
    (fact) => {
      const { slice, chord, active, stableComplete } = fact;
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
      const leading = leadingToneForFunction(slice.key, interpretation);
      const targetLeadingTone = leading.applied ? leading.tone : undefined;
      if (
        targetLeadingTone &&
        fact.tones.some((tone) => pitchClassEquals(tone, targetLeadingTone)) &&
        !directionalTones.some(({ tone }) => pitchClassEquals(tone, targetLeadingTone))
      ) directionalTones.push({ tone: targetLeadingTone, tendency: "up", degree: 7 });
      const repeatedTones = directionalTones.map((item) => ({
        ...item,
        repeated: active.filter(({ note }) => pitchClassEquals(note.pitch, item.tone)),
      })).filter(({ repeated }) => repeated.length > 1);
      repeatedTones.forEach(({ tone, tendency, degree, repeated }) => {
        const report = diagnostic(
          "chord.doubled-altered-tendency-tone",
          slice.tick,
          slice.endTick,
          [],
          [],
          "重复变化倾向音",
          `${chordLabel(chord)} 的 ${formatPitchClass(tone)} 具有明确的${tendency === "up" ? "上行" : "下行"}倾向，不应重复。`,
          {
            chordIds: [chord.id],
            ...(targetLeadingTone && pitchClassEquals(tone, targetLeadingTone)
              ? { coverageRefs: [repeatedTendencyCause(fact, tone, repeated)] }
              : {}),
            params: { degree, tendency, count: repeated.length },
            evidence: [
              chordEvidence(chord),
              ...repeated.map(({ note }) => noteEvidence(note, "重复变化倾向音")),
            ],
          },
        );
        diagnostics.push(repeatedTones.length > 1
          ? { ...report, rootCauseKey: formatPitchClass(tone) }
          : report);
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
      "检查声部中是否存在不属于当前标注和弦构成音、且未说明角色的音符。",
    rationale:
      "四部和声织体中的每一个音符必须具有明确的和声归属——要么为和弦构成音，要么为经过音、辅助音、挂留音等合法非和弦音。未定义角色的离和弦音会导致和声色彩混乱与声部功能不明。",
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
      "检查和弦中是否缺少了不可或缺的关键构成音（如根音或三音）。",
    rationale:
      "三音决定和弦的调式性质（大/小），根音确定和弦的低音骨架与功能定位。四部和声中三和弦通常允许省略五音，但绝不可轻易省略根音与三音（七和弦亦同），否则会导致和弦性质模糊或功能瘫痪。",
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
      "检查男低音是否与标注转位相符；区分结构低音和已标注且有前后音支持的经过音、先现音。",
    rationale:
      "和弦的转位完全取决于最低声部（男低音）所承担的和弦音级：原位必须是根音，第一转位必须是三音，第二转位必须是五音，第三转位必须是七音。低音音级错误将直接导致和弦转位与功能属性的根本性错乱。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    evaluate: inversionBassRule,
  }),
  defineStatelessRule({
    id: "chord.interpretation-identity-conflict",
    catalogNumber: "D.4",
    label: "功能标记与和弦实体冲突",
    description:
      "检查和弦的音符拼写构成与所标注的功能代号是否存在矛盾。",
    rationale:
      "和声分析中罗马数字或功能标记必须严格忠实于实际发音的音程结构与调式音级关系。标记与音符实体不符通常意味着调性误判、音名拼写错误或功能定义不当。",
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
      "检查和弦中是否有两个或以上声部同时使用当前调性或功能目标的书写导音。",
    rationale:
      "导音是调式中最不稳定、具有最强烈向上半音倾向主音的倾向音。如果重复导音，按规范解决时必然导致两个声部同向级进进入主音，从而产生不可避免的平行八度；若其中一个导音不解决，又会违背倾向音解决法则。",
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
      "检查七和弦配置中是否在多个声部重复了七音。",
    rationale:
      "七音是七和弦的不协和核心音，具有严格向向下级进解决的强制倾向。重复七音会导致声部解决时产生平行八度，或者导致其中一个七音无法按规范下行解决，造成不协和音处理不当。",
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
      "检查和弦中具有特定解决方向的变化音（如升五音、降五音等）是否被重复。",
    rationale:
      "变化音（Altered tones）带有强烈的半音级进倾向性（升高音倾向向上、降低音倾向向下）。重复带有单一明确倾向的变化音，在声部规范解决时必然引发平行八度或声部阻碍。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    coveredRuleIds: ["chord.doubled-leading-tone"],
    evaluate: doubledAlteredTendencyToneRule,
  }),
  defineStatelessRule({
    id: "chord.dominant-ninth-voicing",
    catalogNumber: "D.11",
    label: "D9 四声部配置",
    description:
      "检查原位属九和弦在四声部中是否按照标准的 1/3/7/9 结构配置。",
    rationale:
      "属九和弦为五音和弦，在四部和声中必须省略一个音。由于根音（1）、三音（3，导音）、七音（7，下属音）与九音（9）均直接决定该和弦的功能特征与倾向性，因此传统和声学严格规定四部和声中的属九和弦必须省略纯五度的五音，保留 1、3、7、9。",
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
      "检查属九和弦中九音是否置于根音之上九度（即大于一个八度）。",
    rationale:
      "九音与根音在纵向上如果处于同一八度内（形成二度关系），会导致极度粗糙刺耳的二度撞音，且九音的冠音色彩完全丧失。古典和声学要求九音必须置于根音上方九度以上，且九音通常位于最高声部（女高音）。",
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
      "检查增六和弦（意大利/法国/德国增六）的特征构成音与重复音是否合乎规范。",
    rationale:
      "增六和弦由降Ⅵ级与升Ⅳ级构成其标志性的增六度骨架。该增六度两端音均具有强烈的向外反向解决倾向，因此两端音绝对不可重复；意大利增六和弦（三音和弦）在四声部中必须重复调式主音（主干音）。",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    evaluate: augmentedSixthVoicingRule,
  }),
);
