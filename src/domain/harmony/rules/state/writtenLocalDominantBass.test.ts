import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function warnings(parts: readonly string[]) {
  const score = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
${parts.map((part, i) => ` ${"SATB"[i]}: | ${part} |`).join("\n")}
}`).project;
  return checkHarmony(score).diagnostics.filter(d => d.ruleId === "resolution.leading-tone");
}

describe("未标注局部属七的目标", () => {
  it("由根音低音及完整目标三和弦确证 D7 到 G，三音和七音即便都走错也能检查 F♯", () => {
    // Neither the project leading tone B nor a correctly resolving F♯/C is needed at the source.
    const parts = ["F#4/4 D5/4", "C4/4 G4/4", "A3/4 B3/4", "D3/4 G2/4"];
    expect(warnings(parts)).toMatchObject([{
      tick: 960, voiceIds: ["soprano"], params: { leadingTone: "F♯", targetTonic: "G" },
    }]);
    expect(warnings(["F#4/4 G4/4", "C4/4 B3/4", "A3/4 D3/4", parts[3]])).toEqual([]);
  });

  it("调内 I 到 IV 的低音作四五度进行，不给主和弦三音建立离调导音义务", () => {
    expect(warnings(["E4/4 A4/4", "C4/4 C4/4", "G3/4 F3/4", "C3/4 F2/4"])).toEqual([]);
  });
});
