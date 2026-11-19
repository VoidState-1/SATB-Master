import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completeHarmonyResult } from "../domain/harmony/rules/policy/result";
import type {
  ExternalRuleWorkerRequest,
  ExternalRuleWorkerResponse,
} from "../domain/harmony/external/protocol";
import { validateProject, type ProjectDocument } from "../domain/project";
import { compileScoreText } from "../domain/scoreText";
import { DiagnosticsPanel, DiagnosticsSummary } from "../features/diagnostics";
import {
  hashExternalRuleSource,
  installExternalRulePackage,
  listExternalRulePackages,
} from "./externalRuleLibrary";
import { ExternalRuleRuntime, inspectExternalRuleCandidate } from "./externalRuleRuntime";

const SOURCE = `
const spelling = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const germans = ["0:0", "2:4", "4:7", "5:10"];
const diagnose = (slice, message, chord, note) => ({
  tick: slice.tick, endTick: slice.endTick, title: message, message,
  chordIds: chord ? [chord.id] : [], noteIds: note ? [note.id] : [],
});
const definition = (id, dependencyScope, supportsDoubleAugmented43) => ({
  id, label: id, dependencyScope, configVersion: 1, supportsDoubleAugmented43,
});
SATB_RULE.register({
  manifest: {
    apiVersion: 3, packageId: "org.example.spelling", version: "1",
    rules: [
      definition("legacy-german", "slice"),
      definition("legacy-state", "chord"),
      definition("legacy-note", "note"),
      definition("native-evaluate", "slice", true),
      definition("native-state", "chord", true),
    ],
  },
  rules: [{
    id: "legacy-german",
    evaluate(context) {
      return context.slices.flatMap(slice => {
        const chord = slice.chord;
        if (chord?.identity.structure.variant !== "german" || !slice.completeSatb) return [];
        const root = chord.identity.root;
        const written = Object.values(slice.notes).map(({ pitch }) => {
          const steps = ("CDEFGAB".indexOf(pitch.step) - "CDEFGAB".indexOf(root.step) + 7) % 7;
          const semitones = (spelling[pitch.step] + pitch.alter - spelling[root.step] - root.alter + 24) % 12;
          return steps + ":" + semitones;
        }).sort();
        return germans.every((value, index) => value === written[index]) ? [] :
          [diagnose(slice, "德增六实写错误 " + written.join(","), chord)];
      });
    },
  }, {
    id: "legacy-state",
    process(step, incoming) {
      if (step.slice.chord?.identity.structure.variant === "german") {
        return { outgoing: [{
          id: "german", ownerRuleId: "legacy-state",
          createdAt: { tick: step.slice.tick, sliceIndex: step.sliceIndex },
          subjectRefs: { chordIds: [step.slice.chord.id], spanIds: [step.span.id] },
          payload: true,
        }] };
      }
      return { outgoing: [], diagnostics: incoming.length ?
        [diagnose(step.slice, "v3 旧状态已传递")] : [] };
    },
  }, {
    id: "legacy-note",
    evaluate(context) {
      if (JSON.stringify(context).includes("doubleAugmented43")) throw Error("旧载荷泄漏新枚举");
      return context.slices.flatMap(slice => {
        const note = slice.notes.soprano;
        return note?.startTick === slice.tick && note.pitch.step === "D" && note.pitch.alter === 1 ?
          [diagnose(slice, "原始 D# 音符", undefined, note)] : [];
      });
    },
  }, {
    id: "native-evaluate",
    evaluate(context) {
      return context.slices.flatMap(slice => {
        const chord = slice.chord;
        if (chord?.identity.structure.variant !== "doubleAugmented43") return [];
        const span = context.harmonySpans.find(span => span.id === slice.spanId);
        const role = span.semantics.interpretations[0].designation.specialRole;
        const identity = JSON.parse(span.identityKey);
        const spelled = identity.tones.some(tone => tone.step === "D" && tone.alter === 1);
        const sameVariant = candidate => candidate?.identity.structure.variant === "doubleAugmented43";
        if (role !== "doubleAugmented43" || !spelled ||
            !sameVariant(context.project.chordTrack.regions.find(region => region.id === chord.id)) ||
            !sameVariant(context.sliceTransitions[slice.index - 1].current.chord)) {
          throw Error("新形态在 v3 载荷中不一致");
        }
        return [diagnose(slice, "已读到 DD++43", chord)];
      });
    },
  }, {
    id: "native-state",
    process(step, incoming) {
      const chord = step.slice.chord;
      if (chord?.identity.structure.variant === "doubleAugmented43") {
        return { outgoing: [{
          id: "written", ownerRuleId: "native-state",
          createdAt: { tick: step.slice.tick, sliceIndex: step.sliceIndex },
          subjectRefs: { chordIds: [chord.id], spanIds: [step.span.id] },
          payload: step.slice.notes.soprano.pitch.step,
        }] };
      }
      return { outgoing: [], diagnostics: incoming[0]?.payload === "D" &&
        step.transitionFromPrevious?.previous.chord.identity.structure.variant === "doubleAugmented43" ?
        [diagnose(step.slice, "DD++43 状态已传递")] : [] };
    },
  }],
});
`;

const storage = new Map<string, string>();
const replies = new Map<number, (response: ExternalRuleWorkerResponse) => void>();
let dispatch: (event: { data: ExternalRuleWorkerRequest }) => void;

// Replace browser transport only. Worker dispatch, manifest checks and QuickJS run normally.
class InProcessWorker {
  private message?: (event: { data: ExternalRuleWorkerResponse }) => void;
  addEventListener(type: string, handler: InProcessWorker["message"]) {
    if (type === "message") this.message = handler;
  }
  removeEventListener(type: string) {
    if (type === "message") this.message = undefined;
  }
  postMessage(data: ExternalRuleWorkerRequest) {
    replies.set(data.id, (reply) => this.message?.({ data: structuredClone(reply) }));
    dispatch({ data: structuredClone(data) });
  }
  terminate() {
    this.message = undefined;
  }
}

beforeAll(async () => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("Worker", InProcessWorker);
  vi.stubGlobal("self", {
    addEventListener: (_: string, listener: typeof dispatch) => { dispatch = listener; },
    postMessage: (response: ExternalRuleWorkerResponse) => {
      const resolve = replies.get(response.id);
      replies.delete(response.id);
      resolve?.(response);
    },
  });
  await import("../workers/externalRule.worker");
  const candidate = {
    source: SOURCE,
    contentHash: await hashExternalRuleSource(SOURCE),
    sizeBytes: new TextEncoder().encode(SOURCE).byteLength,
  };
  await installExternalRulePackage(candidate, await inspectExternalRuleCandidate(candidate));
});

afterAll(() => vi.unstubAllGlobals());

async function check(secondPitch: string, secondChord: string, ruleIds?: string[], firstPitch = "Eb5") {
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${firstPitch}/4 D5/4 ${secondPitch}/4 E5/4 |
 A: | F#4/4 G4/4 F#4/4 G4/4 |
 T: | C4/4 B3/4 C4/4 C4/4 |
 B: | Ab2/4 G2/4 Ab2/4 G2/4 |
 H: | Ger+6/4 D/4 ${secondChord}/4 K46/4 |
}`);
  const packages = await listExternalRulePackages();
  const [installed] = packages;
  expect(installed.manifest.apiVersion).toBe(3);
  expect(installed.manifest.rules[0]).not.toHaveProperty("supportsDoubleAugmented43");
  expect(installed.manifest.rules[3].supportsDoubleAugmented43).toBe(true);
  project.ruleProfile.external = installed.manifest.rules
    .filter(rule => !ruleIds || ruleIds.includes(rule.id))
    .map(rule => ({
      packageId: installed.manifest.packageId, version: installed.manifest.version,
      contentHash: installed.contentHash, ruleId: rule.id, enabled: true,
      severity: "warning", configVersion: 1, config: {}, exceptions: {},
    }));
  const reopened: ProjectDocument = JSON.parse(JSON.stringify(project));
  expect(validateProject(reopened)).toBe(true);
  const result = await new ExternalRuleRuntime().run({ project: reopened, packages, revision: 1 });
  expect(result.failures).toEqual([]);
  return { result, project: reopened };
}

describe("v3 实写 DD++43 的逐规则兼容", () => {
  it("已安装旧规则在普通工程仍可核对实写纯五度并传递旧状态", async () => {
    const { result: clean } = await check("Eb5", "Ger+6");
    expect(clean.skippedRules).toEqual([]);
    expect(clean.diagnostics.map(item => item.ruleId)).toEqual(["legacy-state", "legacy-state"]);
    const { result: bad } = await check("D#5", "Ger+6");
    expect(bad.skippedRules).toEqual([]);
    expect(bad.diagnostics.find(item => item.ruleId === "legacy-german")).toMatchObject({
      tick: 1920, message: "德增六实写错误 0:0,2:4,3:7,5:10",
    });
  });

  it("混合工程只向声明支持的规则提供真实身份，旧单音规则仍读到 D#，旧和声状态不执行", async () => {
    const { result, project } = await check("D#5", "DD++43", undefined, "D#5");
    expect(project.chordTrack.regions[2].identity.structure).toMatchObject({ variant: "doubleAugmented43" });
    expect(result.skippedRules).toHaveLength(2);
    expect(result.skippedRules.every(skip =>
      skip.reason === "insufficient-context" && !skip.partial && skip.message.includes("1:3:000–1:4:000"),
    )).toBe(true);
    expect(result.diagnostics.map(({ ruleId, tick }) => [ruleId, tick])).toEqual([
      ["legacy-note", 0], ["legacy-note", 1920], ["native-evaluate", 1920], ["native-state", 2880],
    ]);
  });

  it("仅开启旧和声规则时显式报告输入缺口，不显示全通过", async () => {
    const { result, project } = await check("D#5", "DD++43", ["legacy-german"]);
    const harmonyResult = completeHarmonyResult(result);
    expect(result.diagnostics).toEqual([]);
    expect(result.skippedRules).toHaveLength(1);
    const summary = renderToStaticMarkup(createElement(DiagnosticsSummary, { result: harmonyResult }));
    expect(summary).not.toContain("当前范围未发现问题");
    expect(summary).toContain("已跳过 1 条规则");
    const panel = renderToStaticMarkup(createElement(DiagnosticsPanel, {
      project, result: harmonyResult, onSelect() {}, onToggleIgnored() {}, hideHeader: true,
    }));
    expect(panel).toContain("外置规则输入不足");
    expect(panel).toContain("DD++43 位于 1:3:000–1:4:000");
  });
});
