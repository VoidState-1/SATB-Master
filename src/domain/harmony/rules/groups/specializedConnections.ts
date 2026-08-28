import {
  chordStructureQuality,
  chordIdentityToneSpellings,
} from "../../../chordModel";
import { effectiveFunctionalDesignation } from "../../../functionalHarmonyCatalog";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  HarmonySpan,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  isWrittenStep,
  pitchClassEquals,
  toMidi,
  writtenInterval,
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
import type { ConnectionView } from "../context/views";
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

function interpretationOf(context: HarmonyRuleContext, span: HarmonySpan) {
  const resolution = context.harmony.primaryInterpretation(span);
  return resolution.status === "resolved" ? resolution.value : undefined;
}

function toneMembers(
  slice: AnalysisSlice,
  chord: AnalysisChord,
  toneIndex: number,
) {
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
        isWrittenStep(interval!) &&
        (check.direction === "step" ||
          Math.sign(interval!.semitones) ===
            (check.direction === "up" ? 1 : -1)),
      );
      if (valid) return;
      problems.push(
        `${check.label}未${check.direction === "up" ? "上行" : check.direction === "down" ? "下行" : "级进"}解决`,
      );
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
      activeNotes(target).filter(({ note }) =>
        pitchClassEquals(note.pitch, tone),
      ).length,
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
      : isWrittenStep(interval) &&
        Math.sign(interval.semitones) === (inversion === 1 ? 1 : -1);
  return targetMatches && motionMatches
    ? undefined
    : `低音不符合 ${["D7", "D56", "D34", "D2"][inversion]} 的常用解决公式`;
}

type SpecializedBoundary = Pick<
  ConnectionView,
  "sourceBoundary" | "targetBoundary"
> extends infer Boundary
  ? Boundary extends {
      sourceBoundary: infer Source;
      targetBoundary: infer Target;
    }
    ? { source: Source; target: Target }
    : never
  : never;

interface SpecializedConnectionContext {
  connection: ConnectionView["connection"];
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
  sourceMatches(
    context: HarmonyRuleContext,
    span: HarmonySpan,
    chord: AnalysisChord,
  ): boolean;
  targetAllowed(context: HarmonyRuleContext, span: HarmonySpan): boolean;
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

function tonicTarget(context: HarmonyRuleContext, span: HarmonySpan) {
  const interpretation = interpretationOf(context, span);
  return (
    interpretation?.designation?.primaryFunction === "tonic" &&
    interpretation.degree === 1
  );
}

function dominantTarget(context: HarmonyRuleContext, span: HarmonySpan) {
  return (
    interpretationOf(context, span)?.designation?.primaryFunction ===
    "dominant"
  );
}

function dominantOrCadential64Target(
  context: HarmonyRuleContext,
  span: HarmonySpan,
) {
  const interpretation = interpretationOf(context, span);
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
  const bass = dominantBassProblem(
    context.boundary.source,
    context.boundary.target,
  );
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
  if (counts[1] !== 2) result.problems.push("N6 通常重复低音所代表的 IV 级音");
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
    toneMembers(context.boundary.source, context.sourceChord, toneIndex).map(
      ({ voiceId }) =>
        `resolution.${kind}|${context.connection.connectionKey}|voice:${voiceId}`,
    ),
  );
}

function evaluateSpecializedConnection(
  ruleContext: HarmonyRuleContext,
  policy: SpecializedConnectionPolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const candidate of ruleContext.connections()) {
    const { connection, source, target, sourceBoundary, targetBoundary } =
      candidate;
    if (
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      continue;
    const sourceSpan = source.span;
    const targetSpan = target.span;
    if (
      !sourceBoundary.completeSatb ||
      !targetBoundary.completeSatb ||
      !sourceBoundary.chord ||
      !targetBoundary.chord ||
      !policy.sourceMatches(ruleContext, sourceSpan, sourceBoundary.chord)
    )
      continue;
    const context: SpecializedConnectionContext = {
      connection,
      sourceSpan,
      targetSpan,
      boundary: { source: sourceBoundary, target: targetBoundary },
      sourceChord: sourceBoundary.chord,
      targetChord: targetBoundary.chord,
    };
    const result = policy.collectProblems(context);
    if (!policy.targetAllowed(ruleContext, targetSpan))
      result.problems.unshift("后继功能不符合该和弦的目标集合");
    if (result.problems.length === 0) continue;
    const allNotes = [
      ...activeNotes(sourceBoundary).map(({ note }) => note),
      ...activeNotes(targetBoundary).map(({ note }) => note),
      ...result.notes,
    ];
    diagnostics.push(
      diagnostic(
        policy.id,
        targetBoundary.tick,
        targetBoundary.endTick,
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
  }
  return diagnostics;
}

const DOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.dominant-seventh",
  sourceMatches: (context, span, chord) => {
    const interpretation = interpretationOf(context, span);
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
  sourceMatches: (context, span, chord) => {
    const interpretation = interpretationOf(context, span);
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
  sourceMatches: (context, span, chord) => {
    const interpretation = interpretationOf(context, span);
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
  sourceMatches: (context, span, chord) => {
    const interpretation = interpretationOf(context, span);
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
  sourceMatches: (context, span, chord) => {
    const interpretation = interpretationOf(context, span);
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
  sourceMatches: (context, span, chord) =>
    hasSeventh(chord) &&
    interpretationOf(context, span)?.designation?.kind === "double-dominant",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: seventhDownAndCommonToneProblems,
};

const DOUBLE_DOMINANT_LEADING_TONE_POLICY: SpecializedConnectionPolicy = {
  id: "connection.double-dominant-leading-tone",
  sourceMatches: (context, span, chord) =>
    hasSeventh(chord) &&
    interpretationOf(context, span)?.designation?.kind ===
      "double-dominant-leading-tone",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: leadingToneSeventhProblems,
};

const NEAPOLITAN_POLICY: SpecializedConnectionPolicy = {
  id: "connection.neapolitan-sixth",
  sourceMatches: (context, span) =>
    interpretationOf(context, span)?.designation?.kind === "neapolitan",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: neapolitanProblems,
};

export function dominantSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, DOMINANT_SEVENTH_POLICY);
}

export function dominantNinthConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, DOMINANT_NINTH_POLICY);
}

export function leadingToneSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, LEADING_TONE_SEVENTH_POLICY);
}

export function supertonicSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, SUPERTONIC_SEVENTH_POLICY);
}

export function subdominantSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, SUBDOMINANT_SEVENTH_POLICY);
}

export function doubleDominantSeventhConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateSpecializedConnection(
    context,
    DOUBLE_DOMINANT_SEVENTH_POLICY,
  );
}

export function doubleDominantLeadingToneConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateSpecializedConnection(
    context,
    DOUBLE_DOMINANT_LEADING_TONE_POLICY,
  );
}

export function neapolitanSixthConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, NEAPOLITAN_POLICY);
}

export function ambiguousConnectionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const candidate of context.connections()) {
    const { connection, source, target } = candidate;
    if (
      connection.confidence !== "ambiguous" &&
      connection.confidence !== "unknown"
    )
      continue;
    const sourceSpan = source.span;
    const targetSpan = target.span;
    const candidates = [sourceSpan, targetSpan].filter(
      (span): span is HarmonySpan =>
        Boolean(
          span?.semantics &&
          (span.semantics.interpretations.length > 1 ||
            (span.semantics.alternatives?.length ?? 0) > 0),
        ),
    );
    if (candidates.length === 0) continue;
    const chordIds = candidates.flatMap((span) => [...span.regionIds]);
    diagnostics.push(
      diagnostic(
        "function.ambiguous-connection",
        targetSpan.fromTick,
        targetSpan.fromTick,
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
  }
  return diagnostics;
}

export function secondInversionContextRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const role = span.semantics?.cadenceRole;
    if (role !== "passing64" && role !== "pedal64" && role !== "cadential64")
      continue;
    const neighborhood = context.spanNeighborhood(current);
    const previous = neighborhood.previous;
    const next = neighborhood.next;
    if (!previous || !next) continue;
    const previousSpan = previous.span;
    const nextSpan = next.span;
    const previousSlice = previous.lastSlice;
    const firstSlice = current.firstSlice;
    const lastSlice = current.lastSlice;
    const nextSlice = next.firstSlice;
    if (
      !previousSlice?.notes.bass ||
      !firstSlice?.notes.bass ||
      !lastSlice?.notes.bass ||
      !nextSlice?.notes.bass ||
      !firstSlice.chord ||
      chordInversion(firstSlice.chord) !== 2
    )
      continue;
    const into = writtenInterval(
      previousSlice.notes.bass.pitch,
      firstSlice.notes.bass.pitch,
    );
    const out = writtenInterval(
      lastSlice.notes.bass.pitch,
      nextSlice.notes.bass.pitch,
    );
    const nextInterpretation = interpretationOf(context, nextSpan);
    const nextDesignation =
      nextInterpretation && nextSpan.semantics && nextSlice.chord
        ? effectiveFunctionalDesignation(
            nextSpan.semantics,
            chordStructureQuality(nextSlice.chord.identity),
          )
        : undefined;
    const valid =
      role === "passing64"
        ? Math.abs(into.diatonicSteps) === 1 &&
          Math.abs(out.diatonicSteps) === 1 &&
          Math.sign(into.semitones) === Math.sign(out.semitones)
        : role === "pedal64"
          ? toMidi(previousSlice.notes.bass.pitch) ===
              toMidi(firstSlice.notes.bass.pitch) &&
            toMidi(lastSlice.notes.bass.pitch) ===
              toMidi(nextSlice.notes.bass.pitch) &&
            previousSpan.identityKey === nextSpan.identityKey
          : pitchClassEquals(
              lastSlice.notes.bass.pitch,
              nextSlice.notes.bass.pitch,
            ) &&
            nextDesignation?.primaryFunction === "dominant";
    if (valid) continue;
    const currentBassNotes = [
      ...new Map(
        [firstSlice.notes.bass, lastSlice.notes.bass].map((note) => [
          note.id,
          note,
        ]),
      ).values(),
    ];
    const contextBassNotes = [
      ...new Map(
        [previousSlice.notes.bass, nextSlice.notes.bass].map((note) => [
          note.id,
          note,
        ]),
      ).values(),
    ];
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
          subjects: {
            origin: {
              voiceIds: ["bass"],
              noteIds: currentBassNotes.map((note) => note.id),
              chordIds: [...span.regionIds],
              spanIds: [span.id],
            },
            context: {
              voiceIds: ["bass"],
              noteIds: contextBassNotes.map((note) => note.id),
              chordIds: [
                ...previousSpan.regionIds,
                ...nextSpan.regionIds,
              ],
              spanIds: [previousSpan.id, nextSpan.id],
            },
          },
        },
      ),
    );
  }
  return diagnostics;
}

export const SPECIALIZED_CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "function.ambiguous-connection",
    catalogNumber: "G.6",
    label: "功能连接语义不足",
    description:
      "检查和弦连接是否存在多种模棱两可的功能解释且缺乏主导调性支持。",
    rationale:
      "良好的和声进行应具备清晰明确的功能逻辑序列。当和弦音响可以被解释为多种相互冲突的功能关系时，表明调性中心模糊或声部连接逻辑欠明确。",
    group: "function",
    defaultSeverity: "suggestion",
    requires: ["chords"],
    dependencyScope: "phrase",
    evaluate: ambiguousConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-seventh",
    catalogNumber: "H.1",
    label: "D7 解决配置",
    description:
      "检查大小七和弦（D7 及其转位）进入主和弦时导音、七音及低音的解决规范。",
    rationale:
      "属七和弦包含三全音矛盾（导音与下属音）。标准解决要求：导音（3音）上行半音至主音，七音（7音）下行级进至三音，低音由 5 级跳至 1 级（原位）或级进（转位）。原位 D7 解决到原位 T 通常为“完全到不完全”（三根一三，省略五音）或“不完全到完全”。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["resolution.leading-tone", "resolution.chord-seventh"],
    evaluate: dominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-ninth",
    catalogNumber: "H.2",
    label: "D9 解决配置",
    description:
      "检查大/小属九和弦（D9）进入主和弦时九音、七音、导音的同步解决。",
    rationale:
      "属九和弦拥有两个核心倾向音——九音与七音。解决时，九音与七音必须同时向下级进解决至主和弦的五音与三音，导音向上解决至主音，低音跳进至主音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.leading-tone",
      "resolution.chord-seventh",
      "resolution.dominant-ninth",
    ],
    evaluate: dominantNinthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.leading-tone-seventh",
    catalogNumber: "H.3",
    label: "DVII7 解决配置",
    description:
      "检查导七和弦（减七或半减七和弦）进入主和弦时的声部倾向解决。",
    rationale:
      "导七和弦（DVII7）包含两个减五度/增四度音程，紧张度极高。低音（导音）上行解决至主音，七音下行解决至五音，减五度音（三音与五音）分别向内级进收缩解决，通常直接导向重复三音的主三和弦。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: leadingToneSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.supertonic-seventh",
    catalogNumber: "H.4",
    label: "SII7 进入属功能",
    description:
      "检查二级七和弦（SII7）连接至属和弦（V）或终止四六（K46）时的声部进行。",
    rationale:
      "二级七和弦（大调小七、小调半减七）是主要的下属功能七和弦。连接到 Ⅴ 级时，七音（调式主音 1 级）必须顺应倾向下行级进至导音（7 级），或保持为 K46 的六度挂留音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: supertonicSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.subdominant-seventh",
    catalogNumber: "H.5",
    label: "S7 进入属功能",
    description:
      "检查四级七和弦（S7）连接到属功能和弦时的七音下行解决与平稳进行。",
    rationale:
      "四级七和弦七音为调式第 3 级音。连接到属和弦时，该七音应平稳下行级进至属和弦的 2 级音（五音），低音走级进或四五度跳进，避免不良平行。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: subdominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-seventh",
    catalogNumber: "H.6",
    label: "DD7 解决配置",
    description:
      "检查重属七和弦（DD7）引入升4级变化导音后是否规范进入属和弦或 K46。",
    rationale:
      "重属七和弦是向属和弦离调的大附属性和弦。其三音（升Ⅳ级，即属调导音）必须严格上行半音解决至属音（Ⅴ级），七音（调式主音 1 级）下行半音/全音至导音或作为共同音保持。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: doubleDominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-leading-tone",
    catalogNumber: "H.7",
    label: "DDVII7 解决配置",
    description:
      "检查重属导七和弦（DDVII7）中各变化倾向音向属和弦的平稳解决。",
    rationale:
      "重属导七和弦（通常为减七和弦结构）蕴含极强的色彩张力。升Ⅳ级低音上行至属音，其降Ⅵ级七音下行至属和弦五音，多用于高潮段落的属和声准备。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: doubleDominantLeadingToneConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.neapolitan-sixth",
    catalogNumber: "H.8",
    label: "N6 连接",
    description:
      "检查那波里六和弦（降II级六和弦 N6）进入属和弦或 K46 时的低音重复与降2级解决。",
    rationale:
      "那波里六和弦是包含降Ⅱ级音的大三和弦第一转位。低音为调内下属音（Ⅳ级），四声部中必须重复低音（Ⅳ级）；最具特征的降Ⅱ级音必须严格下行减三度跳进至导音，或下行半音至主音（经 K46 解决）。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: neapolitanSixthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.second-inversion-context",
    catalogNumber: "H.13",
    label: "六四和弦进入与离开",
    description:
      "检查经过四六、辅助四六等第二转位和弦的低音线条是否具有连贯的级进或保持。",
    rationale:
      "由于第二转位和弦低音与上方声部的四度不协和性，四六和弦绝不能随意跳进进入或跳进离开。经过四六和弦的低音必须由级进经过形成（如 Ⅰ-Ⅴ46-Ⅰ6）；辅助四六和弦的低音必须保持同音不动（如 Ⅰ-Ⅳ46-Ⅰ）。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: secondInversionContextRule,
  }),
);
