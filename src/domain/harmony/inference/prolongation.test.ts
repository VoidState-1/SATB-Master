import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

function run(soprano: string, tenor = "G3/1", high = false) {
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | ${soprano} |
  A: | C4/1 |
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
      selected: { functionalBaseId: "T", confidence: "medium", fit: { nonChordToneAssignments: {} } },
    });
    expect(region.selected?.fit.nonChordToneNoteIds).toHaveLength(1);
    expect(region.selected?.evidence).toContainEqual({
      kind: "sequence-context", code: "prolonged-harmony", noteIds: region.selected?.fit.nonChordToneNoteIds,
    });
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
