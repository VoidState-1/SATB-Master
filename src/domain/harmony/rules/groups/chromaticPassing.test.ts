import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  line: string;
  key?: string;
  from?: string;
  to?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  middleChord?: string;
  offsetBeats?: number;
}

function warnings({ line, key = "C major", from = "I", to = "IV",
  alto = "E4/2 F4/2", tenor = "C4/1", bass = "C3/2 F3/2", middleChord, offsetBeats = 0 }: Example) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: | ${line} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}
annotations {
  chord before range=[1:1,1:2) symbol=${from}
  ${middleChord ? "chord middle range=[1:2,1:3) symbol=" + middleChord : ""}
  chord after range=[1:3,2:1) symbol=${to}
}`);
  const offset = offsetBeats * project.ppq;
  project.lengthTicks += offset;
  for (const track of project.satbTracks)
    for (const note of track.notes) note.startTick += offset;
  for (const region of project.chordTrack.regions) region.startTick += offset;
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "melody.augmented-interval" && item.voiceIds.includes("soprano"));
}

describe("半音经过时的旋律增一度", () => {
  it("弱拍升高 G 后同向到达下属和弦的 A", () => {
    expect(warnings({ line: "G4/4 G#4/4 A4/2" })).toHaveLength(0);
  });

  it.each([
    ["转向", { line: "G4/4 G#4/4 F4/2" }],
    ["增二度", { line: "G4/4 A#4/4 B4/2" }],
    ["经过音的伴随声部不支持两侧和弦", { line: "G4/4 G#4/4 A4/2", tenor: "C4/4 B3/4 C4/2" }],
    ["中间已标为和弦内音", { line: "G4/4 G#4/4 A4/2", middleChord: "III" }],
    ["同音异名改变两个端点的书写二度", { line: "G4/4 G#4/4 Bbb4/2" }],
    ["中间音位于小节强拍", { line: "G4/4 G#4/4 A4/2", offsetBeats: 3 }],
  ] as const)("%s 时保留诊断", (_label, example) => {
    expect(warnings(example).length).toBeGreaterThan(0);
  });

  const descending = { from: "V", to: "IV", alto: "D4/2 F4/2", tenor: "G3/2 A3/2", bass: "G2/2 F2/2" };
  it("下行 B–B♭–A 的半音写法", () => {
    expect(warnings({ ...descending, line: "B4/4 Bb4/4 A4/2" })).toHaveLength(0);
    expect(warnings({ ...descending, line: "B4/4 A#4/4 A4/2" }).length).toBeGreaterThan(0);
  });

  it.each(["C major", "A minor"])("%s 上行 A–B♭–B 的半音写法", key => {
    const accompaniment = {
      key, from: key === "C major" ? "IV" : "VI", to: key === "C major" ? "V" : "VII",
      alto: "F4/2 D4/2", tenor: "C4/2 B3/2", bass: "F3/2 G3/2",
    };
    expect(warnings({ ...accompaniment, line: "A4/4 Bb4/4 B4/2" })).toHaveLength(0);
    expect(warnings({ ...accompaniment, line: "A4/4 A#4/4 B4/2" }).length).toBeGreaterThan(0);
  });
});
