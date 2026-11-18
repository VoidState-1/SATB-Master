import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function warnings(target: string, before: string, after: string, localKey = "", source = "S6") {
  const project = compileScoreText(`satb 1
key G major
meter 2/4
bars 1..2 {
 S: | ${before}/2 | ${after}/2 |
 A: | G4/2 | G4/2 |
 T: | C4/2 | Bb3/2 |
 B: | E3/2 | Eb3/2 |
}
annotations {
 chord prev range=[1:1,2:1) symbol=${source} ${localKey}
 chord next range=[2:1,3:1) symbol=${target} ${localKey}
}`).project;
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "melody.augmented-interval");
}

describe("重属和弦的同声部半音准备", () => {
  it.each(["viio7/V", "DD7", "V7/V", "Ger+6"])("允许 IV 上行增一度进入 %s 的升 IV", symbol => {
    expect(warnings(symbol, "C5", "C#5").some(d => d.voiceIds.includes("soprano"))).toBe(false);
  });

  it("允许大调 VI 半音下行进入德增六的降 VI", () => {
    expect(warnings("Ger+6", "C5", "C#5").some(d => d.voiceIds.includes("bass"))).toBe(false);
  });

  it("按目标和弦的局部调核对升 IV", () => {
    expect(warnings("V7/V", "F5", "F#5", 'localKey="C major"').some(d => d.voiceIds.includes("soprano"))).toBe(false);
  });

  it("小调 s6→D6 的低音增二度仍须提示", () => {
    const project = compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | F4/4 G4/4 |
 A: | C4/4 D4/4 |
 T: | F3/4 D3/4 |
 B: | Ab2/4 B2/4 |
 H: | s6/4 D6/4 |
}`).project;
    expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "melody.augmented-interval", tick: project.ppq, voiceIds: ["bass"],
    }));
  });

  it.each([
    ["D", "C5", "C#5"],
    ["Ger+6", "C#5", "C5"],
    ["Ger+6", "B4", "C##5"],
    ["viio7/V", "A4", "A#4"],
    ["D", "F4", "G#4"],
  ])("保留目标 %s 中未获该准备条件支持的 %s→%s", (symbol, before, after) => {
    expect(warnings(symbol, before, after).some(d => d.voiceIds.includes("soprano"))).toBe(true);
  });
});

describe("其他副属和弦的导音半音引入", () => {
  it.each([
    { nextNote: "A4", nextChord: "vi", reports: false },
    { nextNote: "E4", nextChord: "vi", reports: true },
    { nextNote: "A4", nextChord: "IV", reports: true },
  ])("G–G#–$nextNote 落在 $nextChord 时，增一度警告为 $reports", ({ nextNote, nextChord, reports }) => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | G4/2 | G#4/2 | ${nextNote}/2 |
 A: | E4/2 | D4/2 | C4/2 |
 T: | C4/2 | B3/2 | E3/2 |
 B: | C3/2 | E3/2 | A2/2 |
 H: | I/2 | V7/VI/2 | ${nextChord}/2 |
}`).project;
    expect(checkHarmony(project).diagnostics.some(diagnostic =>
      diagnostic.ruleId === "melody.augmented-interval" &&
      diagnostic.tick === project.ppq * 2 && diagnostic.voiceIds.includes("soprano"),
    )).toBe(reports);
  });
});
