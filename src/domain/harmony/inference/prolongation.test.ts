import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";

function run(soprano: string, tenor = "G3/1", high = false, alto = "C4/1", key = "C major") {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | C3/1 |
}`);
  return inferChords(project, high ? { minConfidence: "high" } : {}).regions;
}

describe("静止和声中的短时上声部级进", () => {
  it("在两次相同的主和弦之间延续和声，保存所据的音符", () => {
    const [region] = run("E5/4 F5/8 E5/8 E5/2");
    expect(region).toMatchObject({
      fromTick: 0, toTick: 3840,
      selected: { functionalBaseId: "T", confidence: "medium" },
    });
    expect(region.selected?.fit.nonChordToneNoteIds).toHaveLength(1);
    expect(region.selected?.evidence).toContainEqual({
      kind: "sequence-context", code: "prolonged-harmony", noteIds: region.selected?.fit.nonChordToneNoteIds,
    });
    expect(Object.values(region.selected!.fit.nonChordToneAssignments)).toEqual(["neighbor"]);
  });
  it("下辅助在同声部返回，只有启用写回时才标注角色", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E5/4 D5/8 E5/8 |
  A: | G4/2 |
  T: | G3/2 |
  B: | C3/2 |
}`);
    const answer = inferChords(project);
    const noteId = project.satbTracks[0].notes[1].id;
    expect(answer.regions[0].selected?.fit.nonChordToneAssignments).toEqual({ [noteId]: "neighbor" });
    const disabled = inferChords(project, { allowNonChordToneCandidates: false });
    expect(disabled.regions.some(region => region.selected?.fit.nonChordToneAssignments[noteId])).toBe(false);
    for (const write of [false, true]) {
      const applied = applyChordInference(project, answer, { mode: "fill-gaps", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks[0].notes[1].nonChordToneRole).toBe(write ? "neighbor" : undefined);
    }
    for (const tick of [960, 1200, 1440]) {
      project.structure.phraseBoundaries = [{ id: "split", source: "manual", confidence: "certain", tick }];
      const across = inferChords(project).regions;
      expect(across.flatMap(region => region.selected?.evidence ?? []).map(item => item.code))
        .not.toContain("prolonged-harmony");
      expect(across.some(region => region.selected?.fit.nonChordToneAssignments[noteId])).toBe(false);
    }
  });
  it("同调号的新调性事件只在证据窗口内阻断延续", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E5/4 F5/8 E5/8 E5/4 |
  A: | C4/2. |
  T: | G3/2. |
  B: | C3/2. |
}`);
    const original = project.keyEvents[0];
    const result = () => inferChords(project).regions.flatMap(r => r.selected?.evidence ?? []).map(e => e.code);
    expect(result()).toContain("prolonged-harmony");
    for (const tick of [960, 1200, 1440]) {
      project.keyEvents = [original, { ...original, id: "new-key", tick }];
      expect(result()).not.toContain("prolonged-harmony");
    }
    project.keyEvents = [original, { ...original, id: "later-key", tick: 1920 }];
    expect(result()).toContain("prolonged-harmony");
  });

  it("他声部随弱音重奏时保留和声解释并留空辅助音角色", () => {
    const [region] = run("E5/4 F5/8 E5/8 E5/2", "G3/4 G3/2.");
    expect(region.selected?.fit.nonChordToneNoteIds).toHaveLength(1);
    expect(region.selected?.fit.nonChordToneAssignments).toEqual({});
  });
  it.each([
    ["起奏比两侧更强", "E5/8 E5/8 F5/8 E5/8 E5/2", "C4/1", "C major"],
    ["完整大七和弦与下邻竞争", "C5/4 B4/8 C5/8 C5/2", "E4/1", "C major"],
    ["功能模板未枚举的小大七和弦与下邻竞争", "C5/4 B4/8 C5/8 C5/2", "Eb4/1", "C minor"],
  ])("%s时留空角色", (_reason, soprano, alto, key) => {
    const regions = run(soprano, "G3/1", false, alto, key);
    expect(regions.flatMap(r => r.selected?.evidence ?? []).some(e => e.code === "prolonged-harmony")).toBe(true);
    expect(regions.flatMap(r => Object.values(r.selected?.fit.nonChordToneAssignments ?? {}))).toEqual([]);
  });
  it.each([
    ["E5/4 F5/8 E5/8 E5/2", "G3/1", true],
    ["E5/4 A5/8 E5/8 E5/2", "G3/1", false],
    ["E5/4 F5/8 E5/8 E5/2", "G3/4 A3/8 G3/8 G3/2", false],
    ["E5/2 F5/4 E5/4", "G3/1", false],
  ] as const)("高置信过滤、跳进、多声部变化及强位分别保留自身解释 %s / %s / %s", (s, t, high) => {
    expect(run(s, t, high).flatMap(r => r.selected?.evidence ?? []).map(e => e.code)).not.toContain("prolonged-harmony");
  });
});
