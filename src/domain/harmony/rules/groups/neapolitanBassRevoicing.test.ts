import { expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const leapRule = "melody.large-leap";

function passage({
  key = "A minor", soprano = "F5/2.", alto = "Bb4/2.", tenor = "D4/2.",
  bass = "Bb2/4 D2/2", labels = "bII/4 N6/2",
} = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
  H: | ${labels} |
}`).project;
}

function reports(project: ReturnType<typeof passage>, voice = "bass", strict = false) {
  const overrides = strict ? { [leapRule]: { "same-harmony": "strict" as const } } : {};
  return checkHarmony(project, undefined, {}, overrides).diagnostics.some(d =>
    d.ruleId === leapRule && d.tick === project.ppq && d.voiceIds.some(part => part === voice));
}

it.each([
  ["Bb2/4 D2/2", "bII/4 N6/2"],
  ["D2/4 Bb2/2", "N6/4 bII/2"],
])("同调降二级的原位与那不勒斯六和弦以实际低音换位 %s", (bass, labels) => {
  const project = passage({ bass, labels });
  expect(reports(project)).toBe(false);
  expect(reports(project, "bass", true)).toBe(true);
});

it.each([
  ["低音与声明转位相反", { bass: "D2/4 Bb2/2" }],
  ["实际最低音落在男高", { tenor: "D2/2." }],
  ["上声部独立起奏", { tenor: "D4/4 D4/2" }],
  ["缺五音", { soprano: "D5/2." }],
  ["有异名实音", { alto: "A#4/2." }],
  ["换为另一和弦", { labels: "bII/4 iv/2", alto: "Bb4/4 A4/2" }],
  ["属七解决到另一和弦", { key: "D minor", labels: "D7/4 t6/2", soprano: "E5/4 A4/2",
    alto: "G4/4 F4/2", tenor: "C#4/4 D4/2", bass: "A2/4 F3/2" }],
] as const)("%s时保留低音六度建议", (_reason, options) => {
  expect(reports(passage(options))).toBe(true);
});

it("同实音保留确实改变首选局部调的低音建议", () => {
  const project = passage();
  const chord = project.chordTrack.regions[1];
  const semantics = chord.semantics!;
  chord.semantics = { ...semantics, interpretations: semantics.interpretations.map(i => ({
    ...i, localKey: { tonic: { step: "A", alter: 0 }, mode: "major" },
  })) };
  expect(reports(project)).toBe(true);
});

it("同样的原位与一转保留其他特殊功能的区别", () => {
  const project = passage();
  const chord = project.chordTrack.regions[1];
  const semantics = chord.semantics!;
  chord.semantics = { ...semantics, interpretations: semantics.interpretations.map(i => ({
    ...i, designation: { notationSystem: "spasobin", kind: "double-dominant", primaryFunction: "dominant" },
  })) };
  expect(reports(project)).toBe(true);
});

it("属七保持原声部七音的换位沿用已有的同和弦配置", () => {
  const project = passage({ key: "C major", labels: "D7/4 D65/2", soprano: "F5/2.", alto: "D5/2.",
    tenor: "B3/4 G3/2", bass: "G3/4 B2/2" });
  expect(reports(project)).toBe(false);
  expect(reports(project, "bass", true)).toBe(true);
});

it("普通主四六与终止四六实音相同仍区分用途", () => {
  const project = passage({ soprano: "C5/4 A5/2", alto: "A4/2.", tenor: "C4/2.", bass: "E3/2.",
    labels: "i64/4 K46/2" });
  expect(reports(project, "soprano")).toBe(true);
});
