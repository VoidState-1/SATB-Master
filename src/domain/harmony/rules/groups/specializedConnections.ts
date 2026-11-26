import {
  chordIdentityToneSpellings,
  chordStructureQuality,
  type HarmonyInterpretation,
} from "../../../chordModel";
import { effectiveFunctionalDesignation } from "../../../functionalHarmonyCatalog";
import type { HarmonySpan } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import { keyDeclarationEquals, pitchClassEquals, spelledPitchEquals } from "../../../pitch";
import {
  chordEvidence,
  chordInversion,
  diagnostic,
  crossesManualPhraseBoundary,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { SpanView } from "../context/views";
import { continuousPassingBass } from "../../facts/passingSixFour";
import { soundsWrittenMemberSet } from "../../facts/writtenVoicing";
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

/** Major and minor variants of the same auxiliary triad can fill
 * one return frame on a continuously sounding pedal. */
function compoundPedalReturn(context: HarmonyRuleContext, current: SpanView) {
  const center = current.firstSlice.chord?.identity;
  const pedal = current.firstSlice.notes.bass;
  if (!center || !pedal) return false;
  const samePedal = (part: SpanView, id: NonNullable<typeof center>) => part.slices.every(slice =>
    !!slice.notes.bass && spelledPitchEquals(slice.notes.bass.pitch, pedal.pitch) &&
    pitchClassEquals(id.bass, pedal.pitch) && keyDeclarationEquals(slice.key, current.firstSlice.key) &&
    soundsWrittenMemberSet(slice, chordIdentityToneSpellings(id)));
  const variant = (part: SpanView) => {
    const id = part.firstSlice.chord?.identity;
    return id && part.span.semantics?.cadenceRole === "pedal64" &&
      pitchClassEquals(id.root, center.root) && chordInversion(part.firstSlice.chord!) === 2 &&
      id.structure.kind === "tertian" && (id.structure.quality === "major" || id.structure.quality === "minor") &&
      !id.structure.extensions.length && !id.structure.alterations.length && samePedal(part, id)
      ? id.structure.quality : undefined;
  };
  const here = variant(current);
  if (!here) return false;
  const qualities = new Set([here]);
  function outside(side: "previous" | "next") {
    let edge = current;
    for (let i = 0; i < 3; i++) {
      const candidate = context.spanNeighborhood(edge)[side];
      if (!candidate) return;
      const [left, right] = side === "previous" ? [candidate, edge] : [edge, candidate];
      if (left.span.toTick !== right.span.fromTick ||
          crossesManualPhraseBoundary(context, left.span.fromTick, right.span.fromTick)) return;
      const quality = variant(candidate);
      if (quality) {
        qualities.add(quality);
        edge = candidate;
        continue;
      }
      return candidate;
    }
  }
  const before = outside("previous"), after = outside("next");
  const from = before?.lastSlice.chord?.identity, to = after?.firstSlice.chord?.identity;
  if (!before || !after || !from || !to || qualities.size !== 2 ||
      from.structure.kind !== "tertian" || to.structure.kind !== "tertian" ||
      !pitchClassEquals(from.root, to.root) || !pitchClassEquals(from.root, pedal.pitch) ||
      before.span.semantics?.cadenceRole || after.span.semantics?.cadenceRole ||
      (to.structure.quality !== "major" && to.structure.quality !== "minor") ||
      !(from.structure.quality === to.structure.quality ||
        (from.structure.quality === "dominant7" && to.structure.quality === "major")) ||
      !keyDeclarationEquals(before.lastSlice.key, current.firstSlice.key) ||
      !keyDeclarationEquals(after.firstSlice.key, current.firstSlice.key)) return false;
  // Only the facing slices of the enclosing chords are evidence. Earlier
  // ornament attacks in those chords do not interrupt a pedal return.
  const supports = (slice: SpanView["firstSlice"]) =>
    !!slice.chord && !!slice.notes.bass && spelledPitchEquals(slice.notes.bass.pitch, pedal.pitch) &&
    pitchClassEquals(slice.chord.identity.bass, pedal.pitch) && slice.completeSatb;
  if (!supports(after.firstSlice) || !soundsWrittenMemberSet(after.firstSlice, chordIdentityToneSpellings(to))) return false;
  if (from.structure.quality !== "dominant7")
    return supports(before.lastSlice) && soundsWrittenMemberSet(before.lastSlice, chordIdentityToneSpellings(from));
  const tones = chordIdentityToneSpellings(from);
  // In the preceding V7 the fifth may be omitted, and the leading tone
  // need not remain in the last upper-voice configuration.
  return before.slices.every(slice => supports(slice) && soundsWrittenMemberSet(slice, tones, [tones[0], tones[3]])) &&
    before.slices.some(slice => soundsWrittenMemberSet(slice, tones, [tones[0], tones[1], tones[3]]));
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
        ? continuousPassingBass(previousSlice.notes.bass.pitch, firstSlice.notes.bass.pitch,
          lastSlice.notes.bass.pitch, nextSlice.notes.bass.pitch)
        : role === "pedal64"
          ? compoundPedalReturn(context, current) || (pitchClassEquals(
              previousSlice.notes.bass.pitch,
              firstSlice.notes.bass.pitch,
            ) &&
            pitchClassEquals(
              lastSlice.notes.bass.pitch,
              nextSlice.notes.bass.pitch,
            ) &&
            previousSpan.identityKey === nextSpan.identityKey)
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
