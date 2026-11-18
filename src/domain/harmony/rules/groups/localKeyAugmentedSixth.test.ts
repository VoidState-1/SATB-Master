import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function connection(key: string, localKey: string, voices: string[], target = "D") {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..2 {
 S: | ${voices[0]}/2 | ${voices[1]}/2 |
 A: | ${voices[2]}/2 | ${voices[3]}/2 |
 T: | ${voices[4]}/2 | ${voices[5]}/2 |
 B: | ${voices[6]}/2 | ${voices[7]}/2 |
}
annotations {
 chord aug range=[1:1,2:1) symbol=Ger+6 ${localKey ? `localKey="${localKey}"` : ""}
 chord goal range=[2:1,3:1) symbol=${target} ${localKey ? `localKey="${localKey}"` : ""}
}`).project;
}

function errors(project: ReturnType<typeof connection>) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.augmented-sixth");
}

describe("增六解决使用源和弦的局部调性", () => {
  it("局部G大调Eb/C#反向到D，不要求工程Ab大调的Eb属音", () => {
    expect(errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "A3", "G3", "F#3", "Eb3", "D3"]))).toEqual([]);
  });

  it("局部C#小调A/F##反向到G#，保留重升拼写", () => {
    expect(errors(connection("A minor", "C# minor", ["F##4", "G#4", "E4", "D#4", "C#4", "B#3", "A2", "G#2"]))).toEqual([]);
  });

  it("局部调的增六仍可按原规则解决到K46", () => {
    expect(errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "B3", "G3", "G3", "Eb3", "D3"], "K46"))).toEqual([]);
  });

  it("没有局部调性时仍使用工程调性", () => {
    expect(errors(connection("C major", "", ["F#4", "G4", "Eb4", "D4", "C4", "B3", "Ab2", "G2"]))).toEqual([]);
  });

  it("局部调性下高端没有上行半音时仍报错", () => {
    const result=errors(connection("Ab major", "G major", ["C#5", "F#5", "Bb3", "A3", "G3", "F#3", "Eb3", "D3"]));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("高端未上行半音");
    expect(result[0].message).not.toContain("低端未下行半音");
  });

  it("端点半音正确但目标非属或K46时仍报错", () => {
    const result=errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "B3", "G3", "G3", "Eb3", "D3"], "T"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("目标不是明确的属功能或 K46");
  });
});
