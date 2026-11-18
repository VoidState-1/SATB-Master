import { describe, expect, it } from "vitest";
import { createChordRegion } from "./chords";
import { addCadenceAnnotation, updateCadenceAnnotation } from "./editing";
import { createEmptyProject, PPQ, type CadenceAnnotation } from "./project";

function fixture() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.loop.endTick = project.lengthTicks;
  project.chordTrack.regions = [4, 1].map((degree, index) =>
    createChordRegion(project, index * PPQ, PPQ, {
      degree: degree as 1 | 4, degreeAlteration: 0, quality: "major", inversion: 0,
      source: "manual", confidence: "certain",
    }, `chord-${index}`),
  );
  const annotation: CadenceAnnotation = {
    id: "plagal", phraseId: "phrase-0-1920", fromTick: 0, toTick: PPQ * 2,
    kind: "full", form: "plagal", source: "manual", confidence: "certain", locked: false,
  };
  return { project, annotation };
}

describe("补充变格终止标注", () => {
  it("支持新增补充变格，以及全终止和补充终止之间的双向更新", () => {
    const { project, annotation } = fixture();
    const added = addCadenceAnnotation(project, { ...annotation, kind: "supplementary" });
    expect(added.error).toBeUndefined();
    expect(project.chordTrack.cadenceAnnotations).toEqual([]);
    const full = updateCadenceAnnotation(added.project, annotation.id, { kind: "full" });
    expect(full.error).toBeUndefined();
    const supplementary = updateCadenceAnnotation(full.project, annotation.id, { kind: "supplementary" });
    expect(supplementary.error).toBeUndefined();
    expect(supplementary.project.chordTrack.cadenceAnnotations[0]).toMatchObject({ kind: "supplementary", form: "plagal" });
  });

  it.each([
    { kind: "half", form: "plagal" },
    { kind: "deceptive", form: "plagal" },
    { kind: "supplementary", form: "authentic" },
    { kind: "supplementary", form: "plagal", completion: "perfect" },
  ] as const)("拒绝不兼容的种类与限定 $kind / $form", patch => {
    const { project, annotation } = fixture();
    const added = addCadenceAnnotation(project, { ...annotation, ...patch });
    expect(added.error).toBeTruthy();
    expect(added.project).toBe(project);
    const full = addCadenceAnnotation(project, annotation);
    expect(full.error).toBeUndefined();
    const updated = updateCadenceAnnotation(full.project, annotation.id, patch);
    expect(updated.error).toBeTruthy();
    expect(updated.project).toBe(full.project);
  });
});
