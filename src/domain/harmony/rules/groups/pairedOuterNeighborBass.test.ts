import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function example({ soprano = "F5", bass = "B2", returnBass = "C3", first = "I6", last = "I6" } = {}) {
  return compileScoreText(`satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Eb5/4 Eb5/8 ${soprano}/8 | Eb5/4 C5/4 |
  A: | Ab4/2 | Ab4/2 |
  T: | Ab3/2~ | Ab3/2 |
  B: | C3/4. ${bass}/8 | ${returnBass}/2 |
  H: | ${first}/2 | ${last}/2 |
}`).project;
}

function inversionErrors(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.inversion-bass");
}

describe("转位检查识别外声部同步辅助音", () => {
  it.each(["F5", "D5"])("两个外声同时按书写级进折返 %s，两个内声保留支持", soprano => {
    const project = example({ soprano });
    // The two authored regions are separate even though their meanings agree.
    expect(project.chordTrack.regions).toHaveLength(2);
    expect(inversionErrors(project)).toEqual([]);
  });

  it("两侧标注的局部调字段顺序不影响转位检查，真正换调仍报", () => {
    const project = example();
    const [first, last] = project.chordTrack.regions.map(region => region.semantics!.interpretations[0]);
    first.localKey = { tonic: { step: "A", alter: -1 }, mode: "major" };
    last.localKey = { mode: "major", tonic: { alter: -1, step: "A" } };
    expect(inversionErrors(project)).toEqual([]);

    last.localKey.mode = "minor";
    expect(inversionErrors(project)).toContainEqual(expect.objectContaining({
      tick: 1.5 * project.ppq, voiceIds: ["bass"],
    }));
  });

  it.each([
    ["落点改成真实根位", { returnBass: "Ab2", last: "I" }],
    ["出发标注转位写错", { first: "I" }],
    ["返回仍是其它标注转位", { last: "I" }],
    ["同音异名离开", { bass: "Cb3" }],
    ["中间实写一个完整的下属三和弦", { bass: "Db3", soprano: "F5" }],
  ])("%s 时仍报低音与转位不一致", (_description, options) => {
    const project = example(options);
    expect(inversionErrors(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tick: 1.5 * project.ppq, severity: "error", voiceIds: ["bass"] }),
    ]));
  });

  it("出发和弦位置没有装饰时，有实写三音低音仍需标成第一转位", () => {
    const project = example({ first: "I" });
    expect(inversionErrors(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tick: 0, severity: "error" }),
    ]));
  });

  it("回到同一和弦前的手工句界阻止合并", () => {
    const project = example();
    project.structure.phraseBoundaries = [{
      id: "phrase-cut", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    expect(inversionErrors(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tick: 1.5 * project.ppq, severity: "error" }),
    ]));
  });

  it("平行纯五度不视为这类平行辅助音，原规则和转位均报告", () => {
    const project = compileScoreText(`satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Eb5/4 Eb5/8 D5/8 | Eb5/2 |
  A: | C5/2 | C5/2 |
  T: | Ab3/2~ | Ab3/2 |
  B: | Ab2/4. G2/8 | Ab2/2 |
  H: | I/2 | I/2 |
}`).project;
    const tick = 1.5 * project.ppq;
    const diagnostics = checkHarmony(project).diagnostics.filter(item => item.tick === tick);
    expect(diagnostics.map(item => item.ruleId)).toEqual(expect.arrayContaining([
      "voice-leading.parallel-fifths", "chord.inversion-bass",
    ]));
  });
});
