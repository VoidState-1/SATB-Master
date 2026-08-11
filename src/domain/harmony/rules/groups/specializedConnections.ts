import {
  chordIdentityToneSpellings,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  HarmonyAnalysis,
  HarmonySpan,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  pitchClassEquals,
  toMidi,
  writtenInterval,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordInversion,
  chordLabel,
  connectionBoundarySlices,
  diagnostic,
  noteEvidence,
} from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

type SpecializedRuleId =
  | "connection.dominant-seventh"
  | "connection.dominant-ninth"
  | "connection.leading-tone-seventh"
  | "connection.supertonic-seventh"
  | "connection.subdominant-seventh"
  | "connection.double-dominant-seventh"
  | "connection.double-dominant-leading-tone"
  | "connection.neapolitan-sixth";

function interpretationOf(span: HarmonySpan) {
  return span.semantics
    ? primaryHarmonyInterpretation(span.semantics)
    : undefined;
}

function isStepMotion(source: AnalysisNote, target: AnalysisNote) {
  const interval = writtenInterval(source.pitch, target.pitch);
  return (
    Math.abs(interval.diatonicSteps) === 1 &&
    Math.abs(interval.semitones) >= 1 &&
    Math.abs(interval.semitones) <= 2
  );
}

function toneMembers(slice: AnalysisSlice, chord: AnalysisChord, toneIndex: number) {
  const tone = chordIdentityToneSpellings(chord.identity)[toneIndex];
  if (!tone) return [];
  return activeNotes(slice).filter(({ note }) =>
    pitchClassEquals(note.pitch, tone),
  );
}

function targetContains(target: AnalysisSlice, note: AnalysisNote) {
  return Boolean(
    target.chord &&
      chordIdentityToneSpellings(target.chord.identity).some((tone) =>
        pitchClassEquals(note.pitch, tone),
      ),
  );
}

function motionProblems(
  source: AnalysisSlice,
  target: AnalysisSlice,
  sourceChord: AnalysisChord,
  checks: readonly {
    toneIndex: number;
    label: string;
    direction: "up" | "down" | "step";
  }[],
) {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  checks.forEach((check) => {
    toneMembers(source, sourceChord, check.toneIndex).forEach((member) => {
      const next = target.notes[member.voiceId];
      const interval = next
        ? writtenInterval(member.note.pitch, next.pitch)
        : undefined;
      const valid = Boolean(
        next &&
          targetContains(target, next) &&
          isStepMotion(member.note, next) &&
          (check.direction === "step" ||
            Math.sign(interval!.semitones) ===
              (check.direction === "up" ? 1 : -1)),
      );
      if (valid) return;
      problems.push(`${check.label}未${check.direction === "up" ? "上行" : check.direction === "down" ? "下行" : "级进"}解决`);
      voices.push(member.voiceId);
      notes.push(member.note, ...(next ? [next] : []));
    });
  });
  return { problems, voices, notes };
}

function targetConfigurationProblems(target: AnalysisSlice) {
  const chord = target.chord!;
  const tones = chordIdentityToneSpellings(chord.identity);
  const counts = tones.map(
    (tone) =>
      activeNotes(target).filter(({ note }) => pitchClassEquals(note.pitch, tone))
        .length,
  );
  const problems: string[] = [];
  if ((counts[0] ?? 0) === 0) problems.push("目标和弦缺少根音");
  if ((counts[1] ?? 0) === 0) problems.push("目标和弦缺少三音");
  return problems;
}

function dominantBassProblem(source: AnalysisSlice, target: AnalysisSlice) {
  const sourceChord = source.chord!;
  const targetChord = target.chord!;
  const sourceBass = source.notes.bass;
  const targetBass = target.notes.bass;
  if (!sourceBass || !targetBass) return "低音上下文不完整";
  const inversion = chordInversion(sourceChord);
  const targetTones = chordIdentityToneSpellings(targetChord.identity);
  const expectedTargetIndex = inversion === 3 ? 1 : 0;
  const expectedTarget = targetTones[expectedTargetIndex];
  const interval = writtenInterval(sourceBass.pitch, targetBass.pitch);
  const targetMatches = Boolean(
    expectedTarget && pitchClassEquals(targetBass.pitch, expectedTarget),
  );
  const motionMatches =
    inversion === 0
      ? [5, 7].includes(Math.abs(interval.semitones) % 12)
      : isStepMotion(sourceBass, targetBass) &&
        Math.sign(interval.semitones) === (inversion === 1 ? 1 : -1);
  return targetMatches && motionMatches
    ? undefined
    : `低音不符合 ${["D7", "D56", "D34", "D2"][inversion]} 的常用解决公式`;
}

type SpecializedBoundary = NonNullable<
  ReturnType<typeof connectionBoundarySlices>
>;

interface SpecializedConnectionContext {
  connection: HarmonyAnalysis["connections"][number];
  sourceSpan: HarmonySpan;
  targetSpan: HarmonySpan;
  boundary: SpecializedBoundary;
  sourceChord: AnalysisChord;
  targetChord: AnalysisChord;
}

interface SpecializedProblems {
  problems: string[];
  voices: VoiceId[];
  notes: AnalysisNote[];
}

interface SpecializedConnectionPolicy {
  id: SpecializedRuleId;
  sourceMatches(span: HarmonySpan, chord: AnalysisChord): boolean;
  targetAllowed(span: HarmonySpan): boolean;
  collectProblems(context: SpecializedConnectionContext): SpecializedProblems;
  coverageKinds?: readonly {
    kind: "leading-tone" | "chord-seventh" | "dominant-ninth";
    toneIndex: number;
  }[];
}

function emptyProblems(): SpecializedProblems {
  return { problems: [], voices: [], notes: [] };
}

function hasSeventh(chord: AnalysisChord) {
  return (
    chord.identity.structure.kind === "tertian" &&
    chordIdentityToneSpellings(chord.identity).length >= 4
  );
}

function hasNinth(chord: AnalysisChord) {
  return (
    chord.identity.structure.kind === "tertian" &&
    chord.identity.structure.extensions.includes(9)
  );
}

function tonicTarget(span: HarmonySpan) {
  const interpretation = interpretationOf(span);
  return (
    interpretation?.designation?.primaryFunction === "tonic" &&
    interpretation.degree === 1
  );
}

function dominantTarget(span: HarmonySpan) {
  return interpretationOf(span)?.designation?.primaryFunction === "dominant";
}

function dominantOrCadential64Target(span: HarmonySpan) {
  const interpretation = interpretationOf(span);
  return (
    interpretation?.designation?.primaryFunction === "dominant" ||
    interpretation?.designation?.kind === "cadential64"
  );
}

function commonToneProblems(context: SpecializedConnectionContext) {
  const sourceTones = chordIdentityToneSpellings(context.sourceChord.identity);
  const targetTones = chordIdentityToneSpellings(context.targetChord.identity);
  const common = sourceTones.filter((tone) =>
    targetTones.some((candidate) => pitchClassEquals(tone, candidate)),
  );
  const held = VOICE_ORDER.some((voiceId) => {
    const before = context.boundary.source.notes[voiceId];
    const after = context.boundary.target.notes[voiceId];
    return Boolean(
      before &&
        after &&
        toMidi(before.pitch) === toMidi(after.pitch) &&
        common.some((tone) => pitchClassEquals(before.pitch, tone)),
    );
  });
  return common.length > 0 && !held ? ["共同音没有保持"] : [];
}

function motionProblemSet(
  context: SpecializedConnectionContext,
  checks: Parameters<typeof motionProblems>[3],
) {
  return motionProblems(
    context.boundary.source,
    context.boundary.target,
    context.sourceChord,
    checks,
  );
}

function dominantSeventhProblems(context: SpecializedConnectionContext) {
  const result = motionProblemSet(context, [
    { toneIndex: 1, label: "导音", direction: "up" },
    { toneIndex: 3, label: "七音", direction: "down" },
  ]);
  const bass = dominantBassProblem(context.boundary.source, context.boundary.target);
  if (bass) result.problems.push(bass);
  result.problems.push(
    ...commonToneProblems(context),
    ...targetConfigurationProblems(context.boundary.target),
  );
  return result;
}

function dominantNinthProblems(context: SpecializedConnectionContext) {
  const motion = motionProblemSet(context, [
    { toneIndex: 1, label: "导音", direction: "up" },
    { toneIndex: 3, label: "七音", direction: "down" },
    { toneIndex: 4, label: "九音", direction: "down" },
  ]);
  const result = emptyProblems();
  if (chordInversion(context.sourceChord) !== 0)
    result.problems.push("当前仅支持原位 D9");
  result.problems.push(
    ...motion.problems,
    ...commonToneProblems(context),
    ...targetConfigurationProblems(context.boundary.target),
  );
  result.voices.push(...motion.voices);
  result.notes.push(...motion.notes);
  return result;
}

function leadingToneSeventhProblems(context: SpecializedConnectionContext) {
  const result = motionProblemSet(
    context,
    chordIdentityToneSpellings(context.sourceChord.identity).map(
      (_, toneIndex) => ({
        toneIndex,
        label: toneIndex === 0 ? "导音" : `构成音 ${toneIndex + 1}`,
        direction: toneIndex === 0 ? ("up" as const) : ("step" as const),
      }),
    ),
  );
  result.problems.push(...targetConfigurationProblems(context.boundary.target));
  return result;
}

function seventhDownAndCommonToneProblems(
  context: SpecializedConnectionContext,
) {
  const result = motionProblemSet(context, [
    { toneIndex: 3, label: "七音", direction: "down" },
  ]);
  result.problems.push(...commonToneProblems(context));
  return result;
}

function neapolitanProblems(context: SpecializedConnectionContext) {
  const result = emptyProblems();
  const tones = chordIdentityToneSpellings(context.sourceChord.identity);
  const counts = tones.map(
    (tone) =>
      activeNotes(context.boundary.source).filter(({ note }) =>
        pitchClassEquals(note.pitch, tone),
      ).length,
  );
  if (chordInversion(context.sourceChord) !== 1)
    result.problems.push("N6 应使用第一转位");
  if (counts[1] !== 2)
    result.problems.push("N6 通常重复低音所代表的 IV 级音");
  toneMembers(context.boundary.source, context.sourceChord, 0).forEach(
    (member) => {
      const next = context.boundary.target.notes[member.voiceId];
      const interval = next
        ? writtenInterval(member.note.pitch, next.pitch)
        : undefined;
      if (
        !next ||
        !targetContains(context.boundary.target, next) ||
        !interval ||
        interval.semitones >= 0 ||
        Math.abs(interval.semitones) > 3
      ) {
        result.problems.push("降 II 级音未按书写方向下行进入目标");
        result.voices.push(member.voiceId);
        result.notes.push(member.note, ...(next ? [next] : []));
      }
    },
  );
  return result;
}

function resolutionCoverageReferences(
  context: SpecializedConnectionContext,
  kinds: NonNullable<SpecializedConnectionPolicy["coverageKinds"]>,
) {
  return kinds.flatMap(({ kind, toneIndex }) =>
    toneMembers(
      context.boundary.source,
      context.sourceChord,
      toneIndex,
    ).map(
      ({ voiceId }) =>
        `resolution.${kind}|${context.connection.connectionKey}|voice:${voiceId}`,
    ),
  );
}

function evaluateSpecializedConnection(
  analysis: HarmonyAnalysis,
  policy: SpecializedConnectionPolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      return;
    const sourceSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const targetSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const boundary = connectionBoundarySlices(analysis, connection);
    if (
      !sourceSpan ||
      !targetSpan ||
      !boundary ||
      !boundary.source.completeSatb ||
      !boundary.target.completeSatb ||
      !policy.sourceMatches(sourceSpan, boundary.source.chord!)
    )
      return;
    const context: SpecializedConnectionContext = {
      connection,
      sourceSpan,
      targetSpan,
      boundary,
      sourceChord: boundary.source.chord!,
      targetChord: boundary.target.chord!,
    };
    const result = policy.collectProblems(context);
    if (!policy.targetAllowed(targetSpan))
      result.problems.unshift("后继功能不符合该和弦的目标集合");
    if (result.problems.length === 0) return;
    const allNotes = [
      ...activeNotes(boundary.source).map(({ note }) => note),
      ...activeNotes(boundary.target).map(({ note }) => note),
      ...result.notes,
    ];
    diagnostics.push(
      diagnostic(
        policy.id,
        boundary.target.tick,
        boundary.target.endTick,
        [...new Set(result.voices)],
        [...new Map(allNotes.map((note) => [note.id, note])).values()],
        `${chordLabel(context.sourceChord)} 连接配置不规范`,
        `${chordLabel(context.sourceChord)} -> ${chordLabel(context.targetChord)}：${[
          ...new Set(result.problems),
        ].join("；")}。`,
        {
          chordIds: [context.sourceChord.id, context.targetChord.id],
          causeRefs: [`${policy.id}|${connection.connectionKey}`],
          coverageRefs: policy.coverageKinds
            ? resolutionCoverageReferences(context, policy.coverageKinds)
            : [],
          evidence: [
            chordEvidence(context.sourceChord),
            chordEvidence(context.targetChord),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

const DOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.dominant-seventh",
  sourceMatches: (span, chord) => {
    const interpretation = interpretationOf(span);
    const kind = interpretation?.designation?.kind;
    return (
      hasSeventh(chord) &&
      !hasNinth(chord) &&
      interpretation?.degree === 5 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-dominant" &&
      kind !== "double-dominant"
    );
  },
  targetAllowed: tonicTarget,
  collectProblems: dominantSeventhProblems,
  coverageKinds: [
    { kind: "leading-tone", toneIndex: 1 },
    { kind: "chord-seventh", toneIndex: 3 },
  ],
};

const DOMINANT_NINTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.dominant-ninth",
  sourceMatches: (span, chord) => {
    const interpretation = interpretationOf(span);
    const kind = interpretation?.designation?.kind;
    return (
      hasNinth(chord) &&
      interpretation?.degree === 5 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-dominant" &&
      kind !== "double-dominant"
    );
  },
  targetAllowed: tonicTarget,
  collectProblems: dominantNinthProblems,
  coverageKinds: [
    { kind: "leading-tone", toneIndex: 1 },
    { kind: "chord-seventh", toneIndex: 3 },
    { kind: "dominant-ninth", toneIndex: 4 },
  ],
};

const LEADING_TONE_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.leading-tone-seventh",
  sourceMatches: (span, chord) => {
    const interpretation = interpretationOf(span);
    const kind = interpretation?.designation?.kind;
    return (
      hasSeventh(chord) &&
      interpretation?.degree === 7 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-leading-tone" &&
      kind !== "double-dominant-leading-tone"
    );
  },
  targetAllowed: tonicTarget,
  collectProblems: leadingToneSeventhProblems,
};

const SUPERTONIC_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.supertonic-seventh",
  sourceMatches: (span, chord) => {
    const interpretation = interpretationOf(span);
    return (
      hasSeventh(chord) &&
      interpretation?.degree === 2 &&
      interpretation.designation?.primaryFunction === "subdominant"
    );
  },
  targetAllowed: dominantTarget,
  collectProblems: seventhDownAndCommonToneProblems,
};

const SUBDOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.subdominant-seventh",
  sourceMatches: (span, chord) => {
    const interpretation = interpretationOf(span);
    return (
      hasSeventh(chord) &&
      interpretation?.degree === 4 &&
      interpretation.designation?.primaryFunction === "subdominant"
    );
  },
  targetAllowed: dominantTarget,
  collectProblems: seventhDownAndCommonToneProblems,
};

const DOUBLE_DOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.double-dominant-seventh",
  sourceMatches: (span, chord) =>
    hasSeventh(chord) &&
    interpretationOf(span)?.designation?.kind === "double-dominant",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: seventhDownAndCommonToneProblems,
};

const DOUBLE_DOMINANT_LEADING_TONE_POLICY: SpecializedConnectionPolicy = {
  id: "connection.double-dominant-leading-tone",
  sourceMatches: (span, chord) =>
    hasSeventh(chord) &&
    interpretationOf(span)?.designation?.kind ===
      "double-dominant-leading-tone",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: leadingToneSeventhProblems,
};

const NEAPOLITAN_POLICY: SpecializedConnectionPolicy = {
  id: "connection.neapolitan-sixth",
  sourceMatches: (span) =>
    interpretationOf(span)?.designation?.kind === "neapolitan",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: neapolitanProblems,
};

export function dominantSeventhConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, DOMINANT_SEVENTH_POLICY);
}

export function dominantNinthConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, DOMINANT_NINTH_POLICY);
}

export function leadingToneSeventhConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, LEADING_TONE_SEVENTH_POLICY);
}

export function supertonicSeventhConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, SUPERTONIC_SEVENTH_POLICY);
}

export function subdominantSeventhConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, SUBDOMINANT_SEVENTH_POLICY);
}

export function doubleDominantSeventhConnectionRule(
  analysis: HarmonyAnalysis,
) {
  return evaluateSpecializedConnection(
    analysis,
    DOUBLE_DOMINANT_SEVENTH_POLICY,
  );
}

export function doubleDominantLeadingToneConnectionRule(
  analysis: HarmonyAnalysis,
) {
  return evaluateSpecializedConnection(
    analysis,
    DOUBLE_DOMINANT_LEADING_TONE_POLICY,
  );
}

export function neapolitanSixthConnectionRule(analysis: HarmonyAnalysis) {
  return evaluateSpecializedConnection(analysis, NEAPOLITAN_POLICY);
}

export function ambiguousConnectionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (
      connection.confidence !== "ambiguous" &&
      connection.confidence !== "unknown"
    )
      return;
    const sourceSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const targetSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const candidates = [sourceSpan, targetSpan].filter(
      (span): span is HarmonySpan =>
        Boolean(
          span?.semantics &&
            (span.semantics.interpretations.length > 1 ||
              (span.semantics.alternatives?.length ?? 0) > 0),
        ),
    );
    if (candidates.length === 0) return;
    const chordIds = candidates.flatMap((span) => [...span.regionIds]);
    diagnostics.push(
      diagnostic(
        "function.ambiguous-connection",
        targetSpan?.fromTick ?? sourceSpan?.toTick ?? 0,
        targetSpan?.fromTick ?? sourceSpan?.toTick ?? 0,
        [],
        [],
        "功能连接存在互斥解释",
        "前后和弦具有多个会导向不同连接结论的语意解释，请确认主要解释后再应用功能规则。",
        {
          chordIds,
          confidence: 0.6,
          causeRefs: [
            `function.ambiguous-connection|${connection.connectionKey}`,
          ],
          evidence: candidates.map((span) => ({
            kind: "function" as const,
            label: "候选解释数",
            value: String(
              (span.semantics?.interpretations.length ?? 0) +
                (span.semantics?.alternatives?.length ?? 0),
            ),
          })),
        },
      ),
    );
  });
  return diagnostics;
}

export function secondInversionContextRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span, spanIndex) => {
    const role = span.semantics?.cadenceRole;
    if (role !== "passing64" && role !== "pedal64" && role !== "cadential64")
      return;
    const previousSpan = analysis.harmonySpans[spanIndex - 1];
    const nextSpan = analysis.harmonySpans[spanIndex + 1];
    if (!previousSpan || !nextSpan) return;
    const previousSlice = analysis.slices[previousSpan.sliceIndices.at(-1)!];
    const firstSlice = analysis.slices[span.sliceIndices[0]];
    const lastSlice = analysis.slices[span.sliceIndices.at(-1)!];
    const nextSlice = analysis.slices[nextSpan.sliceIndices[0]];
    if (
      !previousSlice?.notes.bass ||
      !firstSlice?.notes.bass ||
      !lastSlice?.notes.bass ||
      !nextSlice?.notes.bass ||
      !firstSlice.chord ||
      chordInversion(firstSlice.chord) !== 2
    )
      return;
    const into = writtenInterval(
      previousSlice.notes.bass.pitch,
      firstSlice.notes.bass.pitch,
    );
    const out = writtenInterval(
      lastSlice.notes.bass.pitch,
      nextSlice.notes.bass.pitch,
    );
    const nextInterpretation = interpretationOf(nextSpan);
    const valid =
      role === "passing64"
        ? Math.abs(into.diatonicSteps) === 1 &&
          Math.abs(out.diatonicSteps) === 1 &&
          Math.sign(into.semitones) === Math.sign(out.semitones)
        : role === "pedal64"
          ? toMidi(previousSlice.notes.bass.pitch) ===
              toMidi(firstSlice.notes.bass.pitch) &&
            toMidi(lastSlice.notes.bass.pitch) === toMidi(nextSlice.notes.bass.pitch) &&
            previousSpan.identityKey === nextSpan.identityKey
          : toMidi(lastSlice.notes.bass.pitch) === toMidi(nextSlice.notes.bass.pitch) &&
            nextInterpretation?.designation?.primaryFunction === "dominant";
    if (valid) return;
    diagnostics.push(
      diagnostic(
        "connection.second-inversion-context",
        span.fromTick,
        span.toTick,
        ["bass"],
        [
          previousSlice.notes.bass,
          firstSlice.notes.bass,
          lastSlice.notes.bass,
          nextSlice.notes.bass,
        ],
        "四六和弦语境与标注不一致",
        role === "passing64"
          ? "经过四六要求低音以同方向级进贯穿前、中、后三个和声。"
          : role === "pedal64"
            ? "辅助四六要求低音保持，并回到原和弦。"
            : "终止四六应保持属音低音进入后继属功能。",
        {
          chordIds: [...span.regionIds],
          evidence: [chordEvidence(firstSlice.chord)],
        },
      ),
    );
  });
  return diagnostics;
}

export const SPECIALIZED_CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "function.ambiguous-connection",
    catalogNumber: "G.6",
    label: "功能连接语义不足",
    description: "和弦实体有效，但前后 interpretation 候选导致不同的合法性结论，且没有人工确认主解释时给出提示。",
    rationale: "这是需要用户确认的语义提示，不得同时产生任何基于任意候选的功能违规。",
    group: "function",
    defaultSeverity: "suggestion",
    requires: [
      "chords"
    ],
    dependencyScope: "phrase",
    evaluate: ambiguousConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-seventh",
    catalogNumber: "H.1",
    label: "D7 解决配置",
    description: "综合检查导音上行、七音下行、共同音保持和目标主和弦的完整/不完整配置；根据 `D7/D56/D34/D2` 分别验证低音走向。",
    rationale: "本条覆盖同一连接上的通用 E.1/E.2 诊断；阻碍解决和转调使用独立 profile。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.leading-tone",
      "resolution.chord-seventh"
    ],
    evaluate: dominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-ninth",
    catalogNumber: "H.2",
    label: "D9 解决配置",
    description: "在 `D9 -> T` 或确认目标连接中联合验证九音下行、七音下行、导音上行和目标和弦配置。",
    rationale: "只处理当前支持的原位 `D9`；覆盖 E.1、E.2、E.3 的同源诊断。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.leading-tone",
      "resolution.chord-seventh",
      "resolution.dominant-ninth"
    ],
    evaluate: dominantNinthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.leading-tone-seventh",
    catalogNumber: "H.3",
    label: "DVII7 解决配置",
    description: "依据 `DVII7` 种类、转位和目标调性，逐声部检查倾向音级进与目标和弦允许重复音。",
    rationale: "减七和弦的等音转调必须先确认新解释，不能沿旧调性误判。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: leadingToneSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.supertonic-seventh",
    catalogNumber: "H.4",
    label: "SII7 进入属功能",
    description: "根据转位和目标类型检查七音下行、共同音与低音走向，并验证后继属于允许的属功能集合。",
    rationale: "序进中的 `SII7` 可能采用不同解决；由序进语境豁免。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: supertonicSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.subdominant-seventh",
    catalogNumber: "H.5",
    label: "S7 进入属功能",
    description: "依据 IV 级七和弦的具体转位检查进入 D 类或其他已允许目标时的声部进行。",
    rationale: "`S7` 不能机械复用 `SII7` 的所有低音与重复规则；需要独立金样本。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: subdominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-seventh",
    catalogNumber: "H.6",
    label: "DD7 解决配置",
    description: "在 G.3 已确认目标成立后，按 D 调性化语境检查变化导音、七音和各转位低音的进行。",
    rationale: "目标调性改变时重新建立局部调性，不能沿主调拼写判断。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: doubleDominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-leading-tone",
    catalogNumber: "H.7",
    label: "DDVII7 解决配置",
    description: "按属调的导七和弦解释检查四个倾向音及后继目标配置。",
    rationale: "等音转调语境优先；与 H.3 共用算法但使用不同局部目标。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: doubleDominantLeadingToneConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.neapolitan-sixth",
    catalogNumber: "H.8",
    label: "N6 连接",
    description: "检查第一转位、通常重复低音所代表的调内 IV 级音，并验证降 II 级音按书写方向进入 D 或经 `K46` 进入 D。",
    rationale: "调式、旋律位置和是否经过 `K46` 会影响声部走向；具体例外待金样本校准。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: neapolitanSixthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.second-inversion-context",
    catalogNumber: "H.13",
    label: "六四和弦进入与离开",
    description: "结合前后 span、低音方向和拍位，验证人工标注的四六类型；经过四六要求低音级进贯穿，辅助四六要求低音保持并回到原和弦。",
    rationale: "首版只验证人工确认类型，不自动给所有 `T46/S46/D46` 指派用途。",
    group: "connection",
    defaultSeverity: "warning",
    requires: [
      "written-pitches",
      "chords",
      "semantics"
    ],
    dependencyScope: "phrase",
    evaluate: secondInversionContextRule,
  }),
);
