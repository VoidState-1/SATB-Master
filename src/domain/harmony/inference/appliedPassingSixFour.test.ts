import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";

const descending = `satb 1
key D major
meter 3/4
bars 1..1 {
  S: | A4/4 B4/4 C#5/4 |
  A: | E4/2. |
  T: | A3/4 G#3/4 A3/4 |
  B: | C#3/4 B2/4 A2/4 |
}`;

function analyze(text: string, cut?: number) {
  const project = compileScoreText(text).project;
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "manual-cut", tick: cut, source: "manual", confidence: "certain" },
  ];
  const result = inferChords(project);
  const middle = result.regions.find(region => region.fromTick <= 960 && 960 < region.toTick)?.selected;
  const applied = applyChordInference(project, result, { mode: "fill-gaps" }).project;
  return { middle, diagnostics: checkHarmony(applied).diagnostics.filter(item => item.tick === 960) };
}

describe("临时主和声的两个转位之间的经过属四六", () => {
  const ascending = descending.replace("A4/4 B4/4 C#5/4", "C#5/4 B4/4 A4/4")
    .replace("C#3/4 B2/4 A2/4", "A2/4 B2/4 C#3/4");

  it.each([["下行", descending], ["上行", ascending]])("低音%s且上方实际交换时写入用途", (_, text) => {
    const { middle, diagnostics } = analyze(text);
    expect(middle?.semantics?.cadenceRole).toBe("passing64");
    expect(middle?.semantics?.interpretations[0].appliedTarget).toMatchObject({ degree: 5, primaryFunction: "dominant" });
    expect(diagnostics.map(d => d.ruleId)).not.toContain("chord.second-inversion-voicing");
    expect(diagnostics.map(d => d.ruleId)).not.toContain("connection.second-inversion-context");
  });

  it("六和弦重复五音时内声部可经属三音作三度进行", () => {
    const doubledFifth = ascending.replace("G#3/4 A3/4", "G#3/4 E3/4");
    expect(analyze(doubledFifth).middle?.semantics?.cadenceRole).toBe("passing64");
    const displaced = doubledFifth.replace("G#3/4 E3/4", "G#3/4 E4/4");
    expect(analyze(displaced).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });

  it("弱拍起奏后持续超过一拍不归为经过", () => {
    const prolonged = descending.replace("meter 3/4", "meter 4/4")
      .replace("B4/4", "B4/2").replace("E4/2.", "E4/1")
      .replace("G#3/4", "G#3/2").replace("B2/4", "B2/2");
    expect(analyze(prolonged).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });

  it("句界隔开落点时仍检查未经证实的四六", () => {
    const { middle, diagnostics } = analyze(descending, 1920);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(diagnostics.map(d => d.ruleId)).toContain("chord.second-inversion-voicing");
  });

  it("低音折返及上方同音级错八度不能证明经过", () => {
    for (const text of [
      descending.replace("C#3/4 B2/4 A2/4", "C#3/4 B2/4 C#3/4"),
      descending.replace("B4/4", "B5/4"),
      descending.replace("G#3/4", "G#2/4"),
    ]) expect(analyze(text).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });
});
