import { primaryHarmonyInterpretation } from "../../../chordModel";
import { analysisKeyAtTick, type HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import {
  formatPitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
} from "../../../pitch";
import {
  chordEvidence,
  chordLabel,
  diagnostic,
} from "../helpers/core";

export function mixtureSourceRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  const qualities = {
    major: [
      "major",
      "minor",
      "minor",
      "major",
      "major",
      "minor",
      "diminished",
    ],
    minor: [
      "minor",
      "diminished",
      "major",
      "minor",
      "minor",
      "major",
      "major",
    ],
  } as const;
  analysis.project.chordTrack.regions.forEach((chord) => {
    const mixture = chord.semantics?.mixture;
    if (!mixture || mixture === "modal") return;
    if (
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.extensions.length > 0 ||
      chord.identity.structure.alterations.length > 0
    )
      return;
    const interpretation = primaryHarmonyInterpretation(chord.semantics!);
    const localKey = interpretation.localKey ??
      analysisKeyAtTick(analysis, chord.startTick);
    const sourceMode =
      mixture === "parallel-major" ? "major" : "minor";
    const sourceKey = { tonic: localKey.tonic, mode: sourceMode } as const;
    const expectedRoot = scaleDegreePitchClass(
      sourceKey,
      interpretation.degree,
      0,
    );
    const expectedQuality = qualities[sourceMode][interpretation.degree - 1];
    if (
      pitchClassEquals(chord.identity.root, expectedRoot) &&
      chord.identity.structure.quality === expectedQuality
    )
      return;
    diagnostics.push(
      diagnostic(
        "tonality.mixture-source",
        chord.startTick,
        chord.startTick + chord.durationTicks,
        [],
        [],
        "借用和弦与来源调式不一致",
        `${chordLabel(chord)} 标注为${mixture === "parallel-major" ? "同主大调" : "同主小调"}借用，但第 ${interpretation.degree} 级应为 ${formatPitchClass(expectedRoot)} ${expectedQuality} 三和弦。`,
        {
          chordIds: [chord.id],
          params: {
            sourceMode,
            degree: interpretation.degree,
            expectedRoot: formatPitchClass(expectedRoot),
            expectedQuality,
          },
          evidence: [
            chordEvidence(chord),
            {
              kind: "key",
              label: "声明的借用来源",
              value: `${formatPitchClass(sourceKey.tonic)} ${sourceMode}`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function functionalRetrogressionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (
      connection.relation !== "retrogression" ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      return;
    const previousSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const currentSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const previous = previousSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (!previous || !current) return;
    diagnostics.push(
      diagnostic(
        "function.retrogression",
        current.startTick,
        current.startTick,
        [],
        [],
        "逆功能进行",
        `${chordLabel(previous)} 到 ${chordLabel(current)} 形成属功能到下属功能的逆向进行。`,
        {
          chordIds: [previous.id, current.id],
          evidence: [
            chordEvidence(previous),
            chordEvidence(current),
            {
              kind: "function",
              label: "功能连接",
              value: connection.evidence
                .filter((item) => item.code.endsWith("family"))
                .map((item) => item.value)
                .join(" → "),
            },
          ],
          confidence: connection.confidence === "certain" ? 1 : 0.8,
          causeRefs: [
            `function.retrogression|${connection.connectionKey}`,
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function doubleDominantTargetRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.connections.forEach((connection) => {
    if (connection.relation !== "double-dominant-target") return;
    const previousSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.previousSpanId,
    );
    const currentSpan = analysis.harmonySpans.find(
      (span) => span.id === connection.currentSpanId,
    );
    const previous = previousSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (
      !previous ||
      !current ||
      !connection.contiguous ||
      connection.targetMatched
    )
      return;
    diagnostics.push(
      diagnostic(
        "function.double-dominant-target",
        current.startTick,
        current.startTick,
        [],
        [],
        "重属功能未进入属功能",
        `${chordLabel(previous)} 通常应进入属功能，或经终止四六进入属功能。`,
        {
          chordIds: [previous.id, current.id],
          evidence: [
            chordEvidence(previous),
            chordEvidence(current),
            {
              kind: "function",
              label: "预期连接",
              value: "重属功能 → 属功能 / K46",
            },
          ],
          confidence:
            connection.confidence === "certain"
              ? 1
              : connection.confidence === "probable"
                ? 0.8
                : 0,
          causeRefs: [
            `function.double-dominant-target|${connection.connectionKey}`,
          ],
        },
      ),
    );
  });
  return diagnostics;
}

export function cadential64ResolutionRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.harmonySpans.forEach((span) => {
    const interpretation = span.semantics
      ? primaryHarmonyInterpretation(span.semantics)
      : undefined;
    if (
      interpretation?.designation?.kind !== "cadential64" &&
      span.semantics?.cadenceRole !== "cadential64"
    )
      return;
    const previous = span.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (!previous) return;
    const connection = analysis.connections.find(
      (candidate) => candidate.previousSpanId === span.id,
    );
    const currentSpan = connection
      ? analysis.harmonySpans.find(
          (candidate) => candidate.id === connection.currentSpanId,
        )
      : undefined;
    const current = currentSpan?.regionIds
      .map((id) => analysis.chordById.get(id))
      .find(Boolean);
    if (
      !connection ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      return;
    const resolves = Boolean(
      connection.relation === "cadential64-target" &&
        connection.targetMatched &&
        connection.contiguous &&
        connection.sameKey,
    );
    if (resolves) return;
    diagnostics.push(
      diagnostic(
        "function.cadential64-target",
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        Math.min(
          analysis.project.lengthTicks,
          previous.startTick + previous.durationTicks,
        ),
        [],
        [],
        "终止四六未进入属和弦",
        `${chordLabel(previous)} 已标记为终止四六，通常应连续进入属功能和弦。`,
        {
          chordIds: current ? [previous.id, current.id] : [previous.id],
          evidence: [
            chordEvidence(previous),
            ...(current ? [chordEvidence(current)] : []),
            {
              kind: "function",
              label: "预期连接",
              value: "终止四六 → 属功能",
            },
          ],
          causeRefs: [
            `function.cadential64-target|${connection.connectionKey}`,
          ],
        },
      ),
    );
  });
  return diagnostics;
}
