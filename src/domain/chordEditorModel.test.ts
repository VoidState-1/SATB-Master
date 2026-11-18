import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./project";
import {
  applyChordEditorAction,
  createChordEditorModel,
} from "./chordEditorModel";
import { applyFunctionalDefinition, functionalDefinition } from "./functionalHarmonyCatalog";

function initialDraft() {
  const project = createEmptyProject();
  return {
    project,
    draft: applyFunctionalDefinition(
      {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        source: "manual" as const,
        confidence: "certain" as const,
      },
      functionalDefinition("D"),
      "major",
    ),
  };
}

describe("ChordEditorModel", () => {
  it("以实际调式区分自然小调 III 与大调中手动改质的 III", () => {
    const { project, draft } = initialDraft();
    const key = project.keyEvents[0];
    const third = applyFunctionalDefinition(draft, functionalDefinition("dtIII"), "minor");
    expect(createChordEditorModel(third, { ...key, mode: "minor" }).baseId).toBe("dtIII");
    expect(createChordEditorModel(third, { ...key, mode: "major" }).baseId).toBe("DTIII");
    const borrowed = applyFunctionalDefinition(draft, functionalDefinition("dtIII"), "major");
    expect(createChordEditorModel(borrowed, { ...key, mode: "major" }).baseId).toBe("dtIII");
  });
  it("统一功能、转位、变化音与共同和弦 action", () => {
    const { project, draft } = initialDraft();
    const key = project.keyEvents[0];
    const seventh = applyChordEditorAction(draft, key, {
      type: "select-functional-form",
      form: "seventh",
    });
    const inverted = applyChordEditorAction(seventh, key, {
      type: "set-inversion",
      inversion: 3,
    });
    const altered = applyChordEditorAction(inverted, key, {
      type: "set-tone-alteration",
      choice: { label: "♭9", degree: 9, alter: -1, tendency: "down" },
    });
    expect(altered).toMatchObject({
      quality: "dominant7",
      inversion: 3,
      alterations: [{ degree: 9, alter: -1, tendency: "down" }],
      secondaryInterpretation: undefined,
    });
  });

  it("模型把候选、转位上限和 action 使用同一事实源", () => {
    const { project, draft } = initialDraft();
    const key = project.keyEvents[0];
    const model = createChordEditorModel(draft, key);
    const result = applyChordEditorAction(draft, key, {
      type: "set-inversion",
      inversion: 3,
    });
    expect(result.inversion).toBe(model.maximumInversion);
    expect(model.canApplyTarget).toBe(true);
    expect(model.secondaryCandidates).toEqual(
      createChordEditorModel(draft, key).secondaryCandidates,
    );
  });

  it("两个编辑器共享的上下文 action 产生唯一领域结果", () => {
    const { project, draft } = initialDraft();
    const key = project.keyEvents[0];
    const actions = [
      { type: "set-mixture", mixture: "modal" },
      { type: "set-cadence-role", cadenceRole: "passing64" },
      { type: "set-pedal-role", role: "start" },
      { type: "set-pedal-pitch", pitch: { step: "G", alter: 0 } },
    ] as const;
    const once = actions.reduce(
      (current, action) => applyChordEditorAction(current, key, action),
      draft,
    );
    const throughPalette = actions.reduce(
      (current, action) => applyChordEditorAction(current, key, action),
      draft,
    );
    const throughInspector = actions.reduce(
      (current, action) => applyChordEditorAction(current, key, action),
      draft,
    );
    expect(throughPalette).toEqual(once);
    expect(throughInspector).toEqual(once);
    expect(once).toMatchObject({
      mixture: "modal",
      cadenceRole: "passing64",
      pedalContext: { role: "start", pitch: { step: "G", alter: 0 } },
    });
  });

  it("结构 action 统一修正转位并清除不再有效的功能解释", () => {
    const { project, draft } = initialDraft();
    const key = project.keyEvents[0];
    const seventh = applyChordEditorAction(draft, key, {
      type: "set-quality",
      quality: "dominant7",
    });
    const triad = applyChordEditorAction(
      { ...seventh, inversion: 3 },
      key,
      { type: "set-quality", quality: "minor" },
    );
    expect(triad).toMatchObject({
      quality: "minor",
      inversion: 2,
      designation: undefined,
      secondaryInterpretation: undefined,
    });
  });
});
