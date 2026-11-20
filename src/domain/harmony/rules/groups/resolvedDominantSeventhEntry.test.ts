import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { defaultHarmonyRuleSeverities } from "../catalog";

const score = `satb 1
key Bb major
meter 3/4
bars 1..1 {
 S: | A4/4 Eb5/4 D5/4 |
 A: | F4/2. |
 T: | C4/4 A3/4 Bb3/4 |
 B: | F2/4 C3/4 Bb2/4 |
 H: | V/4 V43/4 I/4 |
}`;

const rule = "melody.diminished-interval";

function warns(text: string, cut = false) {
  const { project } = compileScoreText(text);
  if (cut) project.structure.phraseBoundaries.push({
    id: "cut", tick: 2 * project.ppq, source: "manual", confidence: "certain",
  });
  return checkHarmony(project, { ...defaultHarmonyRuleSeverities(), "melody.tritone": "off" }, {}, {
    [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
  }).diagnostics.some(item =>
    item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes("soprano"));
}

describe("从属三音跳进到实际引入的七音", () => {
  it("七音同声部下行解决时放行，裸谱也能核对四部", () => {
    expect(warns(score)).toBe(false);
    expect(warns(score.replace(/ H:.*\n/, ""))).toBe(false);
  });

  it.each([
    ["同向继续", score.replace("Eb5/4 D5/4", "Eb5/4 F5/4")],
    ["反向但跳三度", score.replace("Eb5/4 D5/4", "Eb5/4 C5/4")],
    ["有休止才解决", score.replace("Eb5/4", "Eb5/8 r/8")],
    ["虽折回但未构成主和弦", score.replace("Bb3/4", "C4/4")],
    ["进入的七和弦拼写不完整", score.replace("A3/4", "G3/4")],
    ["标签与实奏冲突", score.replace("V43/4", "V65/4")],
  ])("%s 时报告减五度", (_name, text) => expect(warns(text)).toBe(true));

  it("显式句界隔开落主时仍报告", () => expect(warns(score, true)).toBe(true));
});
