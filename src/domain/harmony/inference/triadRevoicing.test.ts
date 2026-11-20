import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";
import type { ChordInferenceOptions } from "./types";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  meter?: string;
  key?: string;
}
function example({
  soprano = "C5/4 F4/4", alto = "F4/2", tenor = "A3/2", bass = "F3/2",
  meter = "2/4", key = "C major",
}: Example = {}) {
  return compileScoreText(`satb 1
key ${key}
meter ${meter}
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}`).project;
}
type Project = ReturnType<typeof example>;

function regionAt(project: Project, tick: number, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.find(region =>
    region.fromTick <= tick && tick < region.toTick);
}

describe("单上声部和弦内换音短暂省五", () => {
  it("前完整后省五只改变候选拟合，正常写回后仍报告真实缺音", () => {
    const project = example();
    const result = inferHarmony(project);
    expect(regionAt(project, PPQ)).toMatchObject({
      fromTick: 0, toTick: 2 * PPQ, status: "resolved",
      selected: {
        functionalBaseId: "S", confidence: "medium",
        fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [], nonChordToneAssignments: {} },
        evidence: expect.arrayContaining([
          { kind: "sequence-context", code: "single-voice-triad-revoicing",
            noteIds: ["note-S-0", "note-S-960"] },
        ]),
      },
    });
    const applied = applyHarmonyInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "chord.incomplete-members", severity: "warning", tick: PPQ, params: { missing: "C" },
    }));
  });

  it("后置完整重属向前补齐和弦身份，选区只写回被选区间", () => {
    const project = example({
      key: "C minor", soprano: "D5/2", alto: "F#4/2", tenor: "D4/4 A3/4", bass: "D3/2",
    });
    const options = { fromTick: PPQ / 4, toTick: PPQ };
    const inferred = inferHarmony(project, options);
    expect(inferred.chordInference.regions).toEqual([expect.objectContaining({
      fromTick: PPQ / 4, toTick: PPQ, status: "resolved",
      selected: expect.objectContaining({
        functionalBaseId: "DD", identity: expect.objectContaining({ root: { step: "D", alter: 0 } }),
        fit: expect.objectContaining({ omittedChordDegrees: [5] }),
      }),
    })]);
    const applied = applyHarmonyInference(project, inferred, { mode: "fill-gaps" });
    expect(applied.project.chordTrack.regions).toEqual([expect.objectContaining({
      startTick: PPQ / 4, durationTicks: 3 * PPQ / 4,
    })]);
    expect(regionAt(project, 0, { minConfidence: "high" })?.status).toBe("unclassified");
  });

  it("后置完整小三和弦支持省五，识别不依靠非和弦音选项", () => {
    const project = example({ soprano: "F4/4 A4/4", alto: "D4/2", tenor: "F3/2", bass: "D3/2" });
    expect(regionAt(project, 0, { allowNonChordToneCandidates: false })?.selected).toMatchObject({
      identity: { root: { step: "D" }, structure: { quality: "minor" } },
      fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [] },
    });
  });

  it.each([
    ["同音重奏的低音", { bass: "F3/4 F3/4" }],
    ["换八度的低音", { bass: "F3/4 F2/4" }],
    ["上方声部跨到记名低音以下", { tenor: "A2/2" }],
    ["同音重奏的另一上方声部", { alto: "F4/4 F4/4" }],
    ["另一端五音写作等音异名", { soprano: "B#4/4 F4/4" }],
    ["较长的省五区间", { meter: "3/4", soprano: "C5/4 F4/2",
      alto: "F4/2.", tenor: "A3/2.", bass: "F3/2." }],
  ] satisfies [string, Example][])("%s 保留未分类", (_label, score) => {
    expect(regionAt(example(score), PPQ)?.status).toBe("unclassified");
  });

  it.each([PPQ, 3 * PPQ / 2])("手动句界 %s 阻止借用完整陈述", tick => {
    const project = example();
    project.structure.phraseBoundaries = [{ id: "boundary", tick, source: "manual", confidence: "certain" }];
    expect(regionAt(project, PPQ)?.status).toBe("unclassified");
  });

  it("同一书写调性重新起调号事件也切断依据", () => {
    const project = example();
    project.keyEvents.push({ ...project.keyEvents[0], tick: PPQ, id: "key-2" });
    expect(regionAt(project, PPQ)?.status).toBe("unclassified");
  });

  it("两侧 F 与 Dm/F 竞争时留空，双方均 F 时可连写", () => {
    const common = { meter: "3/4", alto: "F4/2.", tenor: "A3/2.", bass: "F3/2." };
    const different = example({ ...common, soprano: "C5/4 F4/4 D5/4" });
    expect(regionAt(different, 0)?.selected?.identity.root.step).toBe("F");
    expect(regionAt(different, PPQ)?.status).toBe("unclassified");
    expect(regionAt(different, 2 * PPQ)?.selected?.identity.root.step).toBe("D");
    const same = example({ ...common, soprano: "C5/4 F4/4 C5/4" });
    expect(regionAt(same, PPQ)).toMatchObject({ fromTick: 0, toTick: 3 * PPQ, status: "resolved" });
  });
});
