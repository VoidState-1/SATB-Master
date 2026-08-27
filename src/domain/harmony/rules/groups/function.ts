import type { RuleDiagnostic } from "../../runtime";
import {
  formatPitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
} from "../../../pitch";
import { chordEvidence, chordLabel, diagnostic } from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

export function mixtureSourceRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  const qualities = {
    major: ["major", "minor", "minor", "major", "major", "minor", "diminished"],
    minor: ["minor", "diminished", "major", "minor", "minor", "major", "major"],
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
    const resolution = context.harmony.primaryInterpretation(chord);
    if (resolution.status !== "resolved") return;
    const interpretation = resolution.value;
    const localKey = interpretation.localKey ?? context.keyAt(chord.startTick);
    if (!localKey) return;
    const sourceMode = mixture === "parallel-major" ? "major" : "minor";
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

export function functionalRetrogressionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const candidate of context.connections()) {
    const { connection } = candidate;
    if (
      connection.relation !== "retrogression" ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      continue;
    const previous = candidate.sourceBoundary.chord;
    const current = candidate.targetBoundary.chord;
    if (!previous || !current) continue;
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
          causeRefs: [`function.retrogression|${connection.connectionKey}`],
        },
      ),
    );
  }
  return diagnostics;
}

export function doubleDominantTargetRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const candidate of context.connections()) {
    const { connection } = candidate;
    if (connection.relation !== "double-dominant-target") continue;
    const previous = candidate.sourceBoundary.chord;
    const current = candidate.targetBoundary.chord;
    if (
      !previous ||
      !current ||
      !connection.contiguous ||
      connection.targetMatched
    )
      continue;
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
  }
  return diagnostics;
}

export function cadential64ResolutionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const { analysis } = context;
  for (const candidate of context.spans()) {
    const { span } = candidate;
    const resolution = context.harmony.primaryInterpretation(span);
    const interpretation =
      resolution.status === "resolved" ? resolution.value : undefined;
    if (
      interpretation?.designation?.kind !== "cadential64" &&
      span.semantics?.cadenceRole !== "cadential64"
    )
      continue;
    const previous = candidate.lastSlice.chord;
    if (!previous) continue;
    const outgoing = context.connections({ sourceSpanId: span.id }).first();
    const connection = outgoing?.connection;
    const current = outgoing?.targetBoundary.chord;
    if (
      !connection ||
      !connection.contiguous ||
      !connection.sameKey ||
      connection.confidence === "ambiguous" ||
      connection.confidence === "unknown"
    )
      continue;
    const resolves = Boolean(
      connection.relation === "cadential64-target" &&
      connection.targetMatched &&
      connection.contiguous &&
      connection.sameKey,
    );
    if (resolves) continue;
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
  }
  return diagnostics;
}

export const FUNCTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "function.retrogression",
    catalogNumber: "G.1",
    label: "逆功能进行",
    description:
      "检查和声进行中是否出现了属功能（D）直接进入下属功能（S）的逆向进行。",
    rationale:
      "调式和声的功能逻辑以 T → S → D → T 的向心循环为基石。下属功能是远离主功能的离心力量，属功能是高度紧张、强烈倾向主功能的向心力量。由 D 直接进入 S 违背了功能张力递增并在主和弦释放的自然逻辑，在古典和声中被称为“逆功能进行”（例外如模进或特定阻碍连接除外）。",
    group: "function",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    supportedExceptionContexts: [
      "pedal-point",
      "modulation",
      "ambiguous-semantics",
    ],
    evaluate: functionalRetrogressionRule,
  }),
  defineStatelessRule({
    id: "function.double-dominant-target",
    catalogNumber: "G.3",
    label: "重属功能未进入属功能",
    description:
      "检查重属和弦（DD，即属调的属功能）是否按照规范引入属功能（D）或终止四六。",
    rationale:
      "重属和弦（如 Ⅱ级七和弦变和弦、#Ⅳ级导和弦）引入了属调的导音（调内升Ⅳ级），其全部动力在于强化向属和弦（Ⅴ级）或终止四六（K46）的解决。若离开重属和弦后未能导入属功能，则离调倾向落空，造成调性逻辑混乱。",
    group: "function",
    defaultSeverity: "warning",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    supportedExceptionContexts: ["modulation", "ambiguous-semantics"],
    defaultExceptionPolicies: {
      modulation: "exempt",
    },
    evaluate: doubleDominantTargetRule,
  }),
  defineStatelessRule({
    id: "function.cadential64-target",
    catalogNumber: "G.4",
    label: "终止四六未进入属功能",
    description:
      "检查终止四六和弦（K46）是否紧接着解决到同低音的属和弦。",
    rationale:
      "终止四六（K46）表面上是主和弦的第二转位（T46），但其实质是建立在属音低音之上的重拍双重挂留和弦（六度音与四度音同时挂留）。它必须紧随同低音的属和弦（Ⅴ或Ⅴ7），使六度音下行解决到五度、四度音下行解决到三度（6-5, 4-3），不可单独挪作他用。",
    group: "function",
    defaultSeverity: "error",
    requires: ["chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: cadential64ResolutionRule,
  }),
  defineStatelessRule({
    id: "tonality.mixture-source",
    catalogNumber: "K.4",
    label: "借用和弦来源不一致",
    description:
      "检查借用和弦（同主音大小调调式交替和弦）的音符构成是否与所声明的来源调式一致。",
    rationale:
      "调式交替（Modal Mixture）通常是在大调中引入同主音同名小调的特有和弦（如小下属三和弦 s、降Ⅵ级大和弦 bVI、降Ⅱ级那波里六和弦 N6 等）。借用和弦必须精确保持其源调式的音级结构与升降号特征。",
    group: "tonality",
    defaultSeverity: "error",
    requires: ["chords", "semantics"],
    dependencyScope: "project",
    evaluate: mixtureSourceRule,
  }),
);
