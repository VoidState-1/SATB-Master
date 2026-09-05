import {
  chordStructureQuality,
  type HarmonyInterpretation,
} from "../../../chordModel";
import { effectiveFunctionalDesignation } from "../../../functionalHarmonyCatalog";
import type { HarmonySpan } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { pitchClassEquals } from "../../../pitch";
import {
  chordEvidence,
  chordInversion,
  diagnostic,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

function interpretationOf(context: HarmonyRuleContext, span: HarmonySpan) {
  const resolution = context.harmony.primaryInterpretation(span);
  return resolution.status === "resolved" ? resolution.value : undefined;
}

export function ambiguousConnectionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const ambiguousCandidates = context
    .connections()
    .where(
      ({ connection }) =>
        connection.confidence === "ambiguous" ||
        connection.confidence === "unknown",
    );

  for (const { connection, source, target } of ambiguousCandidates) {
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
    const into = context.pitch.writtenIntervalBetween(
      previousSlice.notes.bass.pitch,
      firstSlice.notes.bass.pitch,
    );
    const out = context.pitch.writtenIntervalBetween(
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
        ? (Math.abs(into.diatonicSteps) === 1 ||
            Math.abs(into.semitones) <= 2) &&
          (Math.abs(out.diatonicSteps) === 1 ||
            Math.abs(out.semitones) <= 2) &&
          Math.sign(into.semitones) === Math.sign(out.semitones)
        : role === "pedal64"
          ? pitchClassEquals(
              previousSlice.notes.bass.pitch,
              firstSlice.notes.bass.pitch,
            ) &&
            pitchClassEquals(
              lastSlice.notes.bass.pitch,
              nextSlice.notes.bass.pitch,
            ) &&
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
