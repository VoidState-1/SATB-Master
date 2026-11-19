import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function projectWithDominantSixth({
  key = "C major",
  soprano = "E5/1@source | C5/1",
  alto = "F4/1 | E4/1",
  tenor = "B3/1 | C4/1",
  bass = "G2/1 | C3/1",
  harmony = "V7/1 | I/1",
  annotations = "",
} = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}
${annotations}`).project;
}

function sourceWarnings(project: ReturnType<typeof projectWithDominantSixth>) {
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === 0 && item.severity === "warning");
}

function heldDominant({
  soprano = "G5/2 E5/2",
  alto = "B4/1",
  tenor = "F4/1",
  tonicTenor = "E4/1",
  harmony = "V7/1",
} = {}) {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} | C5/1 |
 A: | ${alto} | G4/1 |
 T: | ${tenor} | ${tonicTenor} |
 B: | G2/1 | C3/1 |
 H: | ${harmony} | I/1 |
}`).project;
}

function reportsAt(project: ReturnType<typeof heldDominant>, ruleId: string, voiceId: "soprano" | "alto", beat: number) {
  return checkHarmony(project).diagnostics.some(item =>
    item.ruleId === ruleId && item.tick === beat * project.ppq && item.voiceIds.includes(voiceId));
}

describe("原位属七的女高替代六音", () => {
  it.each([
    ["六音下行到属七五音", { soprano: "E5/2@source D5/2 | C5/1" }],
    ["六音下行到主音且内声分别解决", {}],
    ["内声导音下行大三度到完整原位主和弦五音", { tenor: "B3/1 | G3/1" }],
    ["小调六音下行到主音", { key: "C minor", soprano: "Eb5/1@source | C5/1", alto: "F4/1 | Eb4/1", harmony: "V7/1 | i/1" }],
  ])("%s 时放行", (_label, voicing) => {
    expect(sourceWarnings(projectWithDominantSixth(voicing))).toEqual([]);
  });

  it.each([
    ["同响小六音实写为增五音", { key: "C minor", soprano: "D#5/1@source | C5/1", alto: "F4/1 | Eb4/1", harmony: "V7/1 | i/1" }],
    ["导音跳到低八度的主和弦五音", { tenor: "B3/1 | G2/1" }],
    ["七音跳到主和弦五音", { alto: "F4/1 | G4/1" }],
    ["换声部解决导音与七音", { alto: "F4/1 | C4/1", tenor: "B3/1 | E4/1" }],
    ["实写低音非根音", { bass: "D3/1 | C3/1" }],
    ["标注转位非原位", { harmony: "V65/1 | I/1" }],
    ["六音为保留五音的附加音", { alto: "D4/1 | E4/1" }],
    ["下行到五音时内声有异动", { soprano: "E5/2@source D5/2 | C5/1", alto: "F4/2 F3/2 | E4/1" }],
    ["女高仍在邻音位置", { soprano: "E5/2@source F5/2 | C5/1" }],
    ["内声休止使解决上下文不完整", { tenor: "B3/1 | r/1" }],
    ["解决处标注与实际音响冲突", { harmony: "V7/1 | vi/1" }],
    ["局部主和声与题面调号不同", {
      key: "F major",
      harmony: "V7/1@dominant | I/1@tonic",
      annotations: 'annotations {\n chord dominant localKey="C major"\n chord tonic localKey="C major"\n}',
    }],
    ["副属六音下行到五音但无目标", { key: "F major", harmony: "V7/V/1 | I/1", soprano: "E5/2@source D5/2 | C5/1" }],
    ["人工标注持续低音", { bass: "G2/1@pedal | C3/1", annotations: "annotations {\n note pedal role=pedal\n}" }],
  ])("%s 时保留女高警告", (_label, voicing) => {
    const warnings = sourceWarnings(projectWithDominantSixth(voicing));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].voiceIds).toContain("soprano");
  });

  it("保留同一切片中真正的和弦外音", () => {
    const project = projectWithDominantSixth({ alto: "A4/1 | E4/1" });
    const warnings = sourceWarnings(project);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].voiceIds).toEqual(["alto", "soprano"]);
  });

  it("保留跨越和弦起点的持续低音上的警告", () => {
    const project = projectWithDominantSixth({
      soprano: "G4/2 E5/2@source | C5/1",
      alto: "D4/2 F4/2 | E4/1",
      harmony: "V/2 V7/2 | I/1",
    });
    expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "chord.unclassified-nonchord-tone",
      tick: 2 * project.ppq,
      voiceIds: ["soprano"],
      severity: "warning",
    }));
  });

  it.each(["V7/1", "V7/2 V7/2", "V7/2. V7/4"])("同一书写的持续低音，V7 标注为 %s 时结论一致", (harmony) => {
    for (const soprano of ["G5/2 E5/2", "D5/2 E5/2"]) {
      const project = heldDominant({ soprano, harmony });
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(false);
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 3)).toBe(false);
      expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(false);
    }
  });

  it.each([
    ["前和弦并非属七", { tenor: "E4/2 F4/2", harmony: "V/2 V7/2" }],
    ["前拍实写降五，标签合并", { soprano: "Db5/2 E5/2" }],
    ["前拍实写降五，标签拆分", { soprano: "Db5/2 E5/2", harmony: "V7/2 V7/2" }],
    ["前拍实写降五，标签在前拍内部拆分", { soprano: "Db5/2 E5/2", harmony: "V7/4 V7/2." }],
    ["七音未级进下行", { tonicTenor: "G4/1" }],
  ])("%s 时六音和导音例外均失效", (_label, voicing) => {
    const project = heldDominant(voicing);
    expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(true);
    expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
  });

  it("未写替代六音的普通省五属七保留导音义务", () => {
    const project = heldDominant({ soprano: "G5/1" });
    expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 0)).toBe(false);
    expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
  });

  it.each([
    ["原音区重奏", "B4/4 B4/2.", false],
    ["从另一八度重奏", "B3/4 B4/2.", true],
  ] as const)("%s 时只解决对应的导音义务", (_label, alto, reports) => {
    const project = heldDominant({ soprano: "G5/4 G5/4 E5/2", alto });
    expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(false);
    expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(reports);
  });

  it.each([1, 2, 3, 4])("在第 %s 拍的显式句界阻断跨界证据", (beat) => {
    const project = heldDominant({ harmony: "V7/4 V7/2." });
    project.structure.phraseBoundaries = [
      { id: "manual", tick: beat * project.ppq, source: "manual", confidence: "certain" },
    ];
    expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(true);
    expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
  });

  it.each([
    ["在属七区域内重新起奏", "E5/2 E5/4 D5/4 | C5/1", false],
    ["从上一和弦延入属七", "E5/2~ E5/4 D5/4 | C5/1", true],
  ] as const)("同一音高%s时，女高警告为 %s", (_label, soprano, reports) => {
    const project = projectWithDominantSixth({
      soprano,
      alto: "G4/2 F4/2 | E4/1",
      tenor: "C4/2 B3/2 | C4/1",
      bass: "C3/2 G2/2 | C3/1",
      harmony: "I/2 V7/2 | I/1",
    });
    const warnings = checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === 2 * project.ppq);
    expect(warnings).toEqual(reports ? [expect.objectContaining({
      voiceIds: ["soprano"],
      severity: "warning",
    })] : []);
  });
});
