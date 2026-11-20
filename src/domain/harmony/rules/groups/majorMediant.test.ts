import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const progression = `satb 1
key C major
meter 4/4
bars 1..2 {
 S: | C5/4 B4/4 A4/2 | G4/2 G4/2 |
 A: | G4/4 G4/4 F4/2 | D4/2 E4/2 |
 T: | E4/4 E4/4 C4/2 | B3/2 C4/2 |
 B: | C3/4 E3/4 F3/2 | G2/2 C3/2 |
 H: | I/4 iii/4 IV/2 | V/2 I/2 |
}`;

function alerts(text: string, blind = false, local = false) {
  const input = compileScoreText(blind ? text.replace(/^ H:.*$/m, "") : text).project;
  if (local) {
    input.keyEvents[0].tonic = { step: "F", alter: 0 };
    for (const region of input.chordTrack.regions) {
      for (const meaning of region.semantics!.interpretations)
        meaning.localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
    }
  }
  const project = blind
    ? applyHarmonyInference(input, { chordInference: inferChords(input) }, { mode: "replace-unlocked" }).project
    : input;
  return checkHarmony(project).diagnostics.filter(item => item.tick === 1920).map(item => item.ruleId);
}

const retrogression = "function.retrogression";
const leading = "resolution.leading-tone";

describe("大调三级三和弦到下属", () => {
  it.each([false, true])("VII–VI 在 iii→IV 的旋律里成立，盲推 %s", blind => {
    const result = alerts(progression, blind);
    expect(result).not.toContain(retrogression);
    expect(result).not.toContain(leading);
  });

  it("换成属三和弦时，同样的女高下行仍报导音和逆功能", () => {
    const dominant = progression.replace("iii/4", "V/4").replace("E4/4 E4/4", "E4/4 D4/4")
      .replace("C3/4 E3/4", "C3/4 G3/4");
    expect(alerts(dominant)).toEqual(expect.arrayContaining([retrogression, leading]));
  });

  it("三级五音跳进到另一和弦成员也可接下属，不触发 E.1", () => {
    const leap = progression.replace("B4/4 A4/2", "B4/4 F4/2").replace("G4/4 G4/4 F4/2", "G4/4 G4/4 A4/2");
    const result = alerts(leap);
    expect(result).not.toContain(retrogression);
    expect(result).not.toContain(leading);
  });

  it("实际三音与三级标注矛盾时仍报逆功能", () => {
    const result = alerts(progression.replace("G4/4 G4/4", "G4/4 G#4/4"));
    expect(result).toContain(retrogression);
    expect(result).not.toContain(leading);
  });

  it("两端均明确标为局部 C 大调时，按这个调的 VII–VI 判定", () => {
    const result = alerts(progression, false, true);
    expect(result).not.toContain(retrogression);
    expect(result).not.toContain(leading);
  });
});
