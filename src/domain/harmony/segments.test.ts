import { describe, expect, it } from "vitest";
import { chordIdentityEquals, chordIdentityToneSpellings, type ChordIdentity } from "../chordModel";
import { validateProject, type ProjectDocument, PPQ, createEmptyProject } from "../project";
import { compileScoreText } from "../scoreText";
import { buildHarmonyAnalysis } from "./analysis";
import { checkHarmony } from "./registry";
import { correctionChord, correctionProject } from "./testing/fixtures/harmonyProject";
import { type TestChordDraft, addChord } from "./testing/fixtures/chordDrafts";

const repeatedDominant = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | B4/4 G4/4 B4/4 C5/4 |
  A: | F4/4 F4/4 F4/4 E4/4 |
  T: | D4/4 D4/4 D4/4 G3/4 |
  B: | G2/4 G2/4 G2/4 C3/4 |
  H: | D7/4 D7/4 D7/4 T/4 |
}`;
const invertedDominant = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | B4/4 D5/4 C5/4 |
  A: | F4/4 G4/4 G4/4 |
  T: | D4/4 F4/4 E4/4 |
  B: | G2/4 B2/4 C3/4 |
  H: | D7/4 D65/4 T/4 |
}`;

function passage(score = repeatedDominant, count = 3) {
  const { project } = compileScoreText(score);
  const semantics = project.chordTrack.regions[0].semantics!;
  semantics.interpretations[0].localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
  for (const region of project.chordTrack.regions.slice(0, count)) {
    region.semantics = structuredClone(semantics);
  }
  return project;
}

function reverseFields<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).reverse()) as T;
}

function reorderIdentity(identity: ChordIdentity) {
  const { step, alter } = identity.root;
  identity.root = { alter, step };
  const structure = identity.structure;
  if (structure.kind !== "tertian") throw new Error("Fixture requires a tertian chord");
  const { kind, quality, extensions, alterations } = structure;
  identity.structure = {
    alterations: alterations.map(reverseFields),
    extensions, quality, kind,
  };
}

function check(project: ProjectDocument) {
  expect(validateProject(project)).toBe(true);
  const analysis = buildHarmonyAnalysis(project);
  return {
    spans: analysis.harmonySpans.map(({ fromTick, toTick, regionIds, identityKey }) =>
      ({ fromTick, toTick, regionIds, identityKey })),
    connections: analysis.connections,
    result: checkHarmony(project),
  };
}

describe("书写和弦身份", () => {
  it.each(["structure", "semantics"] as const)(
    "同一属七的 %s 字段重排保持段落、连接和诊断",
    (field) => {
      const project = passage();
      const reordered = structuredClone(project);
      const target = reordered.chordTrack.regions[1];
      if (field === "structure") reorderIdentity(target.identity);
      else {
        const semantics = target.semantics!;
        semantics.interpretations[0].localKey = { mode: "major", tonic: { alter: 0, step: "C" } };
        target.semantics = reverseFields(semantics);
      }

      const baseline = check(project);
      expect(baseline.spans.map(span => span.fromTick)).toEqual([0, project.ppq * 3]);
      expect(baseline.result.diagnostics.some(item => item.ruleId === "resolution.leading-tone")).toBe(false);
      expect(check(reordered)).toEqual(baseline);
    },
  );

  it("保留真实重解释与转位，同时让连接与 span 共用书写身份", () => {
    const project = passage(invertedDominant, 2);
    const [source, target] = project.chordTrack.regions;
    const semantics = target.semantics!;
    semantics.primaryInterpretationId = semantics.interpretations[0].id = "reinterpretation";
    semantics.interpretations[0].designation!.primaryFunction = "subdominant";
    const baseline = check(project);
    expect(baseline.spans).toHaveLength(3);
    expect(baseline.connections[0].relation).toBe("pivot-reinterpretation");
    expect(chordIdentityEquals(source.identity, target.identity)).toBe(false);
    expect(baseline.spans[0].identityKey).toBe(JSON.stringify({
      root: source.identity.root,
      structure: source.identity.structure,
      tones: chordIdentityToneSpellings(source.identity),
    }));

    const reordered = structuredClone(project);
    reorderIdentity(reordered.chordTrack.regions[1].identity);
    expect(check(reordered)).toEqual(baseline);
  });

  it("解释 ID 不变时也保留实际功能变化的 span 边界", () => {
    const project = passage();
    const target = project.chordTrack.regions[1].semantics!.interpretations[0];
    target.designation!.primaryFunction = "subdominant";

    const result = check(project);
    expect(result.spans.map(span => span.fromTick)).toEqual([0, project.ppq, project.ppq * 2, project.ppq * 3]);
    expect(result.connections[0].evidence).toContainEqual({ code: "current-family", value: "subdominant" });
  });

  it("变音字段重排可比较，变音方向和数组顺序继续影响身份", () => {
    const project = passage();
    const [source, target, continuation] = project.chordTrack.regions;
    for (const chord of [source, target, continuation]) {
      chord.identity.structure = {
        kind: "tertian", quality: "dominant7", extensions: [9, 11],
        alterations: [{ degree: 5, alter: 1, tendency: "up" }, { degree: 9, alter: -1 }],
      };
    }
    const baseline = check(project);
    const reordered = structuredClone(project);
    const identity = reordered.chordTrack.regions[1].identity;
    reorderIdentity(identity);
    expect(chordIdentityEquals(source.identity, identity)).toBe(true);
    expect(check(reordered)).toEqual(baseline);
    const structure = identity.structure;
    if (structure.kind !== "tertian") throw new Error("Fixture requires a tertian chord");
    for (const change of [
      { extensions: [...structure.extensions].reverse() },
      { alterations: [...structure.alterations].reverse() },
      { alterations: [{ ...structure.alterations[0], tendency: "down" as const }, structure.alterations[1]] },
    ]) {
      identity.structure = { ...structure, ...change };
      expect(chordIdentityEquals(source.identity, identity)).toBe(false);
      expect(check(reordered).spans).toHaveLength(4);
    }
  });
});

describe("规则引擎修正基线", () => {
  it("单个和弦区域内部的调号变化必须切断 HarmonySpan", () => {
    const project = correctionProject(PPQ * 2);
    project.chordTrack.regions = [correctionChord("tonic-region", 0, PPQ * 2)];
    project.keyEvents.push({
      id: "key-change",
      tick: PPQ,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });

    const analysis = buildHarmonyAnalysis(project, 1);
    expect(analysis.harmonySpans).toHaveLength(2);
    expect(
      analysis.harmonySpans.map((span) => [span.fromTick, span.toTick]),
    ).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
    ]);
  });
});

describe("斯波索宾基础规则检查", () => {
  it("置信度变化会切断 HarmonySpan，避免确定语义覆盖歧义语义", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      confidence: "certain",
    };
    addChord(project, "certain-tonic", 0, tonic);
    addChord(project, "ambiguous-tonic", 1, {
      ...tonic,
      confidence: "ambiguous",
    });

    const analysis = buildHarmonyAnalysis(project);
    const spans = analysis.harmonySpans;
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.status)).toEqual(["complete", "ambiguous"]);
  });
});
