import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function warning({ key = "Ab major", soprano = "C5 Db5 C5 Db5 C5",
    alto = "Ab4 Ab4 Ab4 G4 Ab4", tenor = "F4 Bb3 Eb4 Bb3 Eb4",
    bass = "F3 Fb3 Eb3 Eb3 C3", labels = "", cut = -1 } = {}) {
  const parts = [soprano, alto, tenor, bass].map((s, i) =>
    " " + ["S", "A", "T", "B"][i] + ": | " + s.split(" ").map(n => n + "/4").join(" ") + " |");
  const { project } = compileScoreText(`satb 1
key ${key}
meter 5/4
bars 1..1 {
${parts.join("\n")}
}${labels ? "\nannotations {\n " + labels + "\n}" : ""}`);
  if (cut >= 0) project.structure.phraseBoundaries = [{
    id: "cut", source: "manual", confidence: "certain", tick: cut * project.ppq,
  }];
  return checkHarmony(project).diagnostics.some(d => d.tick === project.ppq &&
    d.ruleId === "melody.augmented-interval" && d.voiceIds.includes("bass"));
}

describe("Borrowed supertonic fifth in the bass", () => {
  it("reads vi–ii half-diminished 43–I64 in the prevailing major key", () => {
    expect(warning()).toBe(false);
  });
  it("accepts an independently confirmed major target after the parallel minor", () => {
    expect(warning({ key: "F major" })).toBe(false);
  });
  it.each([
    ["seventh transferred to another voice", { soprano: "C5 Db5 Ab4 Db5 C5", alto: "Ab4 Ab4 C5 G4 Ab4" }],
    ["same pitch class but not the same octave", { alto: "Ab4 Ab4 Ab3 G4 Ab4" }],
    ["enharmonic third", { soprano: "C5 C#5 C5 Db5 C5" }],
    ["incomplete supertonic", { soprano: "C5 Bb4 C5 Db5 C5" }],
    ["wrong preceding minor triad", { tenor: "D4 Bb3 Eb4 Bb3 Eb4" }],
    ["foreign key without the confirming seventh", { key: "F major", soprano: "C5 Db5 C5 Bb4 C5" }],
    ["foreign leading tone handed to the soprano", { key: "F major", soprano: "C5 Db5 C5 Db5 Ab4", alto: "Ab4 Ab4 Ab4 G4 C5" }],
    ["different annotated target", { labels: "chord bad range=[1:3,1:4) symbol=V" }],
    ["boundary at six-four", { cut: 2 }],
    ["boundary inside the local confirmation", { key: "F major", cut: 4 }],
  ] as const)("retains the original spelling warning when evidence fails: %s", (_label, input) => {
    expect(warning(input)).toBe(true);
  });
});
