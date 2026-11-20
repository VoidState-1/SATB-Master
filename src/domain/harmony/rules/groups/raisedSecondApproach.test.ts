import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { diminishedIntervalRule } from "./melody";

// Constructed in compound meter. The tenor approaches the cadential third.
// In first inversion the bass stays on F while the soprano raises Db to D.
const firstInversion = `satb 1
key Ab major
meter 6/8
bars 1..2 {
 S: | Db5/4. D5/8 Eb5/4 | Db5/2. |
 A: | Ab4/2. | G4/2. |
 T: | Db4/4. B3/8 C4/4 | Bb3/2. |
 B: | F3/2 Eb3/4 | Eb3/2. |
}
annotations {
 chord prep range=[1:1,1:4) symbol=S6
 chord leading range=[1:4,1:5) symbol=viio65/V
 chord cadence range=[1:5,2:1) symbol=K46
 chord dominant range=[2:1,3:1) symbol=D7
}`;

// Here the soprano holds the common tonic throughout. The alto and tenor
// resolve in contrary motion at the barline, after the new bass has sounded.
const earlyBass = `satb 1
key Ab major
meter 6/8
bars 1..2 {
 S: | Ab4/2.~ | Ab4/4. G4/4. |
 A: | F4/4. F4/4. | Eb4/4. Db4/4. |
 T: | Db4/4. B3/4. | C4/4. Bb3/4. |
 B: | Db3/4. D3/4 Eb3/8~ | Eb3/4. Eb3/4. |
}
annotations {
 chord prep range=[1:1,1:4) symbol=S
 chord leading range=[1:4,1:6) symbol=viio7/V
 chord cadence range=[1:6,2:4) symbol=K46
 chord dominant range=[2:4,3:1) symbol=D7
}`;

const rule = "melody.diminished-interval";
function edit(score: string, from: string, to: string) {
  expect(score.split(from)).toHaveLength(2);
  return score.replace(from, to);
}

function tenorWarning(score: string, boundary?: number) {
  const project = compileScoreText(score).project;
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "cut", tick: boundary, source: "manual", confidence: "certain",
  });
  const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const matches = (d: { ruleId: string; tick: number; voiceIds: readonly string[] }) =>
    d.ruleId === rule && d.tick === 1440 && d.voiceIds.includes("tenor");
  const strict = { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } } as const;
  return [
    diminishedIntervalRule(context).some(matches),
    checkHarmony(project, undefined, {}, strict).diagnostics.some(matches),
  ];
}

describe("男高以下行减三度进入重属导七的改记七音", () => {
  it.each([
    ["第一转位，由女高升四级和男高升二级同步解决", firstInversion],
    ["原位，低音先到，两个内声在小节线处实际解决", earlyBass],
    ["终止四六从上方实际解决时标起", edit(earlyBass, "cadence range=[1:6", "cadence range=[2:1")],
    ["中间标签空缺，四部仍完整", edit(firstInversion, " chord leading range=[1:4,1:5) symbol=viio65/V\n", "")],
    ["显式局部大调", edit(firstInversion, "key Ab major", "key F minor")
      .replaceAll(/symbol=(\S+)/g, 'symbol=$1 localKey="Ab major"')],
  ])("%s", (_, score) => expect(tenorWarning(score)).toEqual([false, false]));

  it.each([
    ["男高在低音到达时重奏升二级", edit(earlyBass, "B3/4.", "B3/4 B3/8")],
    ["女低在低音到达时重奏六级", edit(earlyBass, "F4/4. F4/4.", "F4/4. F4/4 F4/8")],
    ["提前的低音是另一音", edit(earlyBass, "Eb3/8~", "F3/8")],
    ["低音在上方解决时换八度", edit(earlyBass, "Eb3/8~ | Eb3/4.", "Eb3/8 | Eb2/4.")],
    ["第一转位的导音从异音区跳入", edit(firstInversion, "Db5/4.", "Db6/4.")],
    ["第一转位的导音没有到属音", edit(firstInversion, "D5/8 Eb5/4", "D5/8 C5/4")],
    ["延迟解决的女低转向三音", edit(earlyBass, "Eb4/4. Db4/4.", "C4/4. Db4/4.")],
    ["男高改到另一音区", edit(firstInversion, "C4/4 |", "C5/4 |")],
    ["同样落在主四六，标作普通转位", edit(firstInversion, "symbol=K46", "symbol=I64")],
    ["终止功能留空", edit(firstInversion, " chord cadence range=[1:5,2:1) symbol=K46\n", "")],
    ["降六低音与升四位于不同声部，构成异名增六", edit(
      edit(earlyBass, "Db3/4. D3/4", "Db3/4. Fb3/4"), "F4/4. F4/4.", "F4/4. D4/4.")],
    ["中段明确标记半减七", edit(firstInversion, "viio65/V", "viiø65/V")],
    ["低音先到期间另换属七", edit(earlyBass, "cadence range=[1:6",
      "intervening range=[1:6,2:1) symbol=D7\n chord cadence range=[2:1")],
    ["终点换调", edit(firstInversion, "symbol=K46", 'symbol=K46 localKey="Eb major"')],
    ["改记七音有显式外音角色", edit(earlyBass, " chord prep", " note T@1:4 role=passing\n chord prep")],
  ])("%s 时保留减三度警告", (_, score) => expect(tenorWarning(score)).toEqual([true, true]));

  it.each([1440, 2400, 2880])("句界 %i 隔开进入、低音先到或上方解决", tick => {
    expect(tenorWarning(earlyBass, tick)).toEqual([true, true]);
  });
});
