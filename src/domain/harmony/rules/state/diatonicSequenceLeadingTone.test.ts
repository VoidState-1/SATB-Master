import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { PPQ } from "../../../project/types";
import { checkHarmony } from "../../registry";

interface Example {
  initialSoprano?: string;
  thirdTenor?: string;
  lastSoprano?: string;
}

function example({
  initialSoprano = "F4/4 E4/4",
  thirdTenor = "E3/2",
  lastSoprano = "C4/2",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..5 {
 S: | ${initialSoprano} | E4/4 D4/4 | D4/4 C4/4 | A4/4 B3/4 | ${lastSoprano} |
 A: | D4/4 C4/4 | C4/4 B3/4 | B3/4 A3/4 | A3/4 G3/4 | G3/2 |
 T: | G3/2 | F3/2 | ${thirdTenor} | D3/2 | E3/2 |
 B: | B2/4 C3/4 | A2/4 B2/4 | G2/4 A2/4 | F2/4 G2/4 | C2/2 |
 H: | V65/4 I/4 | r/4 DVII/4 | iii65/4 vi/4 | ii65/4 V/4 | I/2 |
}
annotations {
 chord fourth at=2:1 duration=1/4 draft="{\\"degree\\":4,\\"degreeAlteration\\":0,\\"quality\\":\\"major7\\",\\"inversion\\":1,\\"source\\":\\"manual\\",\\"confidence\\":\\"certain\\"}"
}`).project;
}

function leadingWarnings(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics
    .filter(item => item.ruleId === "resolution.leading-tone")
    .map(({ tick, voiceIds }) => [tick, ...voiceIds]);
}

const seamWarnings = [[4 * PPQ, "bass"], [5 * PPQ, "alto"]];

function doubledLeadingTones(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.doubled-leading-tone");
}

describe("第 26 章调内模进中的导音义务", () => {
  it("放行第二组尾的旧义务，以及在第三组头同音重奏后才离开的声部", () => {
    expect(leadingWarnings(example())).toEqual([]);
  });

  it.each<[string, Example]>([
    ["前一组换了女高八度，只有其后两组能相配", { initialSoprano: "F5/4 E5/4" }],
    ["四声部音高相同但内声部起奏节奏不再相配", { thirdTenor: "E3/4 E3/4" }],
    ["其余三个声部仍移位，男高破坏第三组和弦", { thirdTenor: "G3/2" }],
  ])("%s 时仍报告两条导音", (_label, options) => {
    expect(leadingWarnings(example(options))).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("手动句界阻止借用之前一组的移位证据", () => {
    const project = example();
    project.structure.phraseBoundaries.push({
      id: "boundary", tick: 2 * PPQ, source: "manual", confidence: "certain",
    });
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("三组移位相同但实际最低声部与标注转位矛盾时保留导音警告", () => {
    const project = example();
    const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
    for (const note of tenor.notes) note.pitch.octave -= 2;
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("显式局部调阻止借用相同实音的移位证据", () => {
    const project = example();
    const meanings = project.chordTrack.regions.find(chord => chord.startTick === PPQ)?.semantics?.interpretations;
    expect(meanings?.length).toBe(1);
    const meaning = meanings![0];
    meaning.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
    expect(leadingWarnings(project)).toEqual(expect.arrayContaining(seamWarnings));
  });

  it("模进后真正的 V→I 女高 B3 错到 E4，仍报告其导音", () => {
    expect(leadingWarnings(example({ lastSoprano: "E4/2" }))).toEqual([[8 * PPQ, "soprano"]]);
  });
});

describe("调内模进复制的减三和弦重复根音", () => {
  const repeatedRoot = expect.objectContaining({ tick: 3 * PPQ, severity: "error", voiceIds: ["alto", "bass"] });

  it("四声部确实依次移位时可复制七级和弦的重复根音", () => {
    expect(doubledLeadingTones(example())).toEqual([]);
  });

  it.each<Example>([{ thirdTenor: "E3/4 E3/4" }, { initialSoprano: "F5/4 E5/4" }])(
    "有一组节奏或音区不匹配时仍报重复导音", variation => {
      expect(doubledLeadingTones(example(variation))).toContainEqual(repeatedRoot);
    },
  );

  it("穿过换句的音组不作为重复依据", () => {
    const project = example();
    project.structure.phraseBoundaries.push({ id: "cut", tick: 4 * PPQ, source: "manual", confidence: "certain" });
    expect(doubledLeadingTones(project)).toContainEqual(repeatedRoot);
  });

  it("属六和弦中的两个导音仍报错", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | D5/4 E5/4 |
 A: | B4/4 C5/4 |
 T: | G4/2 |
 B: | B2/4 C3/4 |
 H: | V6/4 I/4 |
}`).project;
    expect(doubledLeadingTones(project)).toContainEqual(expect.objectContaining({
      tick: 0, severity: "error", voiceIds: ["alto", "bass"],
    }));
  });
});
