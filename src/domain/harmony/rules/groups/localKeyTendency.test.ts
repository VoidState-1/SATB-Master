import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function localCadence(sopranoLanding = "A4", localKey = "A major") {
  return compileScoreText(`satb 1
key F major
meter 2/4
bars 1..2 {
 S: | G#4/2 | ${sopranoLanding}/2 |
 A: | E4/2 | C#4/2 |
 T: | B3/2 | E4/2 |
 B: | E3/2 | A2/2 |
}
annotations {
 chord d range=[1:1,2:1) symbol=D localKey="${localKey}"
 chord t range=[2:1,3:1) symbol=T localKey="${localKey}"
}`).project;
}

describe("明示局部调性中的导音识别", () => {
  it("按局部 A 大调核对 G# 到 A，不把工程 F 大调的 E 当导音", () => {
    const diagnostics = checkHarmony(localCadence()).diagnostics;
    expect(diagnostics.filter(item => item.ruleId === "resolution.leading-tone")).toEqual([]);
  });

  it("仍报告局部调性中真正未解决的 G#，并保留目标主音 A", () => {
    const diagnostics = checkHarmony(localCadence("F#4")).diagnostics
      .filter(item => item.ruleId === "resolution.leading-tone");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].voiceIds).toContain("soprano");
    expect(diagnostics[0].debug?.obligation?.partitionKey).toBe("voice:soprano|target:A:0");
  });

  it("不把局部 A 大调属和弦的重复根音 E 当成重复导音", () => {
    const diagnostics = checkHarmony(localCadence()).diagnostics
      .filter(item => item.ruleId === "chord.doubled-leading-tone");
    expect(diagnostics).toHaveLength(0);
  });

  it("仍报告局部 A 大调真正重复的 G# 导音", () => {
    const project = localCadence();
    project.satbTracks.find(track => track.voice === "alto")!.notes[0].pitch = { step: "G", alter: 1, octave: 4 };
    const diagnostics = checkHarmony(project).diagnostics
      .filter(item => item.ruleId === "chord.doubled-leading-tone");
    expect(diagnostics).toHaveLength(1);
    expect(new Set(diagnostics[0].voiceIds)).toEqual(new Set(["soprano", "alto"]));
  });
});
