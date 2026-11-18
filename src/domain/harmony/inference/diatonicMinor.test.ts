import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

describe("自然小调与和声小调的三和弦", () => {
  it.each([
    ["E4", "C4", "G3", "C3", "dtIII", "C", 0],
    ["D4", "B3", "G3", "B2", "dVII", "G", 0],
    ["E4", "C4", "G#3", "C3", "DTIII", "C", 0],
    ["D4", "B3", "G#3", "G#2", "DVII", "G", 1],
  ] as const)("a 小调的 %s %s %s %s 按实写的第七级区分", (s, a, t, b, base, step, alter) => {
    const project = compileScoreText(`satb 1
key A minor
meter 4/4
bars 1..1 {
  S: | ${s}/1 |
  A: | ${a}/1 |
  T: | ${t}/1 |
  B: | ${b}/1 |
}`).project;
    const [region] = inferChords(project).regions;
    expect(region).toMatchObject({ status: "resolved", selected: { functionalBaseId: base, identity: { root: { step, alter } } } });
  });
});

