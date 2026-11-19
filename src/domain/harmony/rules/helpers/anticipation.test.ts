import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const parallel = {
  key: "F major",
  soprano: "Bb4/2.. A4/8@top | A4/1",
  alto: "E4/1 | F4/1",
  tenor: "C4/1 | C4/1",
  bass: "G3/2.. F3/8@low | F3/1",
  harmony: "V43/1 | I/1",
  roles: "note top role=anticipation\n note low role=anticipation",
};

const singleBass = {
  ...parallel,
  soprano: "Bb4/1 | C5/1",
  alto: "E4/1 | F4/1",
  tenor: "C4/1 | C4/1",
  bass: "G3/2.. A3/8@low | A3/1",
  harmony: "V43/1 | I6/1",
  roles: "note low role=anticipation",
};

const rootPosition = {
  ...parallel,
  soprano: "A4/1 | Bb4/1",
  alto: "F4/1 | E4/1",
  tenor: "C4/1 | C4/1",
  bass: "F3/2.. G3/8@low | G3/1",
  harmony: "I/1 | V43/1",
  roles: "note low role=anticipation",
};

function checkFixture(score: typeof parallel, beat = 3.5) {
  const { project } = compileScoreText(`satb 1
key ${score.key}
meter 4/4
bars 1..2 {
 S: | ${score.soprano} |
 A: | ${score.alto} |
 T: | ${score.tenor} |
 B: | ${score.bass} |
 H: | ${score.harmony} |
}
${score.roles ? "annotations {\n " + score.roles + "\n}" : ""}`);
  return checkHarmony(project).diagnostics.filter(item => item.tick === beat * project.ppq);
}

describe("先现音与和弦配置", () => {
  const missingRule = "chord.incomplete-members";
  const doublingRule = "chord.triad-root-position-doubling";

  it.each([
    ["先现低音暂代属七和弦的五音", singleBass, "G"],
    ["平行十度暂代属七和弦的五音和七音", parallel, "G,B♭"],
    ["反向暂代属七和弦的三音和七音", {
      ...parallel,
      key: "F minor",
      soprano: "E5/2.. F5/8@top | F5/1",
      alto: "Bb4/2.. Ab4/8@inner | Ab4/1",
      bass: "G3/1 | F3/1",
      harmony: "V43/1 | i/1",
      roles: "note top role=anticipation\n note inner role=anticipation",
    }, "E,B♭"],
    ["先现低音暂代六和弦的三音", {
      ...parallel,
      soprano: "C5/1 | Bb4/1",
      alto: "F4/1 | F4/1",
      tenor: "C4/1 | D4/1",
      bass: "A3/2.. Bb3/8@low | Bb3/1",
      harmony: "I6/1 | IV/1",
      roles: "note low role=anticipation",
    }, "A"],
  ] as const)("%s", (_label, score, missing) => {
    expect(checkFixture(score).some(item => item.ruleId === missingRule)).toBe(false);
    expect(checkFixture({ ...score, roles: "" })).toContainEqual(
      expect.objectContaining({ ruleId: missingRule, severity: "warning", params: { missing } }),
    );
  });

  it("恢复被先现低音替代的原位根音重复", () => {
    expect(checkFixture(rootPosition).some(item => item.ruleId === doublingRule)).toBe(false);
    expect(checkFixture({ ...rootPosition, roles: "" })).toContainEqual(
      expect.objectContaining({ ruleId: doublingRule, severity: "suggestion", params: { counts: "1/1/1", inversion: 0 } }),
    );
  });

  it("重算后仍报告真实的三音重复", () => {
    expect(checkFixture({
      ...rootPosition,
      soprano: "A4/2.. Bb4/8@top | Bb4/1",
      alto: "A3/1 | F4/1",
      tenor: "C4/1 | D4/1",
      bass: "F3/1 | Bb3/1",
      harmony: "I/1 | IV/1",
      roles: "note top role=anticipation",
    })).toContainEqual(
      expect.objectContaining({
        ruleId: doublingRule,
        severity: "suggestion",
        params: { counts: "1/2/1", inversion: 0 },
        evidence: expect.arrayContaining([
          expect.objectContaining({ label: "先现前的结构音", value: "A4" }),
        ]),
      }),
    );
  });

  it("保留其他声部换音导致的真实缺音", () => {
    expect(checkFixture({ ...parallel, alto: "E4/2.. C4/8 | F4/1" })).toContainEqual(
      expect.objectContaining({ ruleId: missingRule, params: { missing: "E" } }),
    );
  });

  it("其他声部在先现前后插入同音重奏时仍能核对结构音", () => {
    const score = { ...parallel, alto: "E4/2. E4/16 E4/8 E4/16 | F4/1" };
    expect(checkFixture(score, 3.75).some(item => item.ruleId === missingRule)).toBe(false);
    expect(checkFixture({ ...score, roles: "" }, 3.75)).toContainEqual(
      expect.objectContaining({ ruleId: missingRule, params: { missing: "G,B♭" } }),
    );
  });

  it.each([
    ["标为 other", { roles: "note low role=other" }, 3.5, "G"],
    ["后继换八度", { bass: "G3/2.. A3/8@low | A2/1" }, 3.5, "G"],
    ["同音异名", { bass: "G3/2.. Bbb3/8@low | A3/1" }, 3.5, "G"],
    ["延音跨越边界", { bass: "G3/2.. A3/8@low~ | A3/1" }, 3.5, "G"],
    ["重奏晚于和弦边界", { bass: "G3/2.. A3/8@low | r/8 A3/2.." }, 3.5, "G"],
    ["前音与先现之间有休止", { bass: "G3/2. r/8 A3/8@low | A3/1" }, 3.5, "G"],
    ["先现过长", { bass: "G3/2. A3/4@low | A3/1" }, 3, "G"],
    ["后继没有更强拍位", {
      soprano: "Bb4/2.. C5/8 | C5/1",
      alto: "E4/2.. F4/8 | F4/1",
      bass: "G3/2. G3/16 A3/16@low A3/8 | A3/1",
      harmony: "V43/2.. I6/8 | I6/1",
    }, 3.25, "G"],
    ["后继重奏比先现更短", { bass: "G3/2.. A3/8@low | A3/16 A3/16 A3/2.." }, 3.5, "G"],
    ["后继别的声部休止", { tenor: "C4/1 | r/8 C4/2.." }, 3.5, "G"],
    ["后继转位不符", { harmony: "V43/1 | I/1" }, 3.5, "G"],
    ["后继同音被另标为和弦外音", {
      bass: "G3/2.. A3/8@low | A3/1@land",
      roles: "note low role=anticipation\n note land role=passing",
    }, 3.5, "G"],
    ["先现前原弦已缺三音", { alto: "C4/1 | F4/1" }, 3.5, "E,G"],
    ["结构前音只在其他和弦下发声", { harmony: "I/2.. V43/8 | I6/1" }, 3.5, "G"],
    ["同时改变的他声部出现未证实的和弦外音", { alto: "E4/2.. F4/8 | F4/1" }, 3.5, "E,G"],
  ] as const)("%s 时保留缺音", (_label, change, beat, missing) => {
    expect(checkFixture({ ...singleBass, ...change }, beat)).toContainEqual(
      expect.objectContaining({ ruleId: missingRule, severity: "warning", params: { missing } }),
    );
  });

  it("标为双重先现的平行五度仍报告缺音", () => {
    expect(checkFixture({
      ...parallel,
      soprano: "D5/2.. C5/8@top | C5/1",
      alto: "B4/1 | A4/1",
      tenor: "F4/1 | F4/1",
      bass: "G3/2.. F3/8@low | F3/1",
      key: "C major",
      harmony: "V7/1 | IV/1",
    })).toContainEqual(expect.objectContaining({ ruleId: missingRule, params: { missing: "G" } }));
  });
});
