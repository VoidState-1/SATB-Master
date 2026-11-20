import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const rule = "melody.augmented-interval";
const lowered = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | B4/2 C5/2 |
  A: | G4/1 |
  T: | D4/4 Db4/4 C4/2 |
  B: | F3/2 E3/2 |
}`;
const raised = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | G4/1 |
  A: | D4/4 D#4/4 E4/2 |
  T: | B3/2 C4/2 |
  B: | G3/4 F3/4 E3/2 |
}`;

function warnsAtChange(score: string, voice: "tenor" | "alto") {
  const { project } = compileScoreText(score);
  return checkHarmony(project, undefined, {}, {
    [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
  }).diagnostics.some(item => item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes(voice));
}

describe("属和弦变五音的半音准备（第46章）", () => {
  it("降五音在原声部下行到主音，主六和弦也可确认落点", () => {
    expect(warnsAtChange(lowered, "tenor")).toBe(false);
  });
  it("升五音在原声部上行到大调主三音", () => {
    expect(warnsAtChange(raised, "alto")).toBe(false);
  });
  it("升五音延续期间，属三和弦可增加七音", () => {
    const score = raised.replace("G3/4 F3/4 E3/2", "G3/4. F3/8 E3/2");
    expect(warnsAtChange(score, "alto")).toBe(false);
  });
  it("本调属准备与外观相同的主到下属均无半音入音警告", () => {
    const triad = raised.replace("G3/4 F3/4 E3/2", "G3/2 E3/2");
    expect(warnsAtChange(triad, "alto")).toBe(false);
    expect(warnsAtChange(triad.replace("key C major", "key G major"), "alto")).toBe(false);
  });
  it.each([
    ["落点由另一声部代奏", lowered.replace("Db4/4 C4/2", "Db4/4 E4/2")],
    ["错拼落点", lowered.replace("Db4/4 C4/2", "Db4/4 B#3/2")],
    ["隔休止才出现主音", lowered.replace("Db4/4 C4/2", "Db4/8 r/8 C4/2")],
    ["无属三音", lowered.replace("B4/2 C5/2", "A4/2 C5/2")],
    ["后继另成和弦", lowered.replace("F3/2 E3/2", "F3/2 A2/2")],
    ["中间改换和声", lowered.replace("B4/2 C5/2", "B4/4. A4/8 C5/2")],
  ])("%s 时缺少变五音解决证据，入音仍无 B.3", (_why, score) => {
    expect(warnsAtChange(score, "tenor")).toBe(false);
  });
});

describe("连续两个属和弦引入外调的增三和弦", () => {
  const progression = `satb 1
key F# minor
meter 3/4
bars 1..1 {
 S: | B4/4 B#4/4 C#5/4 |
 A: | F#4/4 E4/4 A4/4 |
 T: | D#4/4 E4/4 E4/4 |
 B: | B2/4 G#2/4 A2/4 |
}`;

  function hasWarning(text: string) {
    const { project } = compileScoreText(text);
    return checkHarmony(project, undefined, {}, {
      [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
    }).diagnostics.some(item => item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes("soprano"));
  }

  it.each([
    ["属三和弦", progression],
    ["先行属七和弦的七音同声部下行", progression.replace("B2/4 G#2/4", "A2/4 G#2/4")],
    ["移调后的局部 C 大调", progression.replace("F# minor", "A minor")
      .replace("B4/4 B#4/4 C#5/4", "D5/4 D#5/4 E5/4")
      .replace("F#4/4 E4/4 A4/4", "A4/4 G4/4 C5/4")
      .replace("D#4/4 E4/4 E4/4", "F#4/4 G4/4 G4/4")
      .replace("B2/4 G#2/4 A2/4", "D3/4 B2/4 C3/4")],
  ])("%s 的两个导音和升五音各自解决", (_label, text) => {
    expect(hasWarning(text)).toBe(false);
  });

  it.each([
    ["先行和弦成为小三和弦", progression.replace("D#4/4", "D4/4")],
    ["另一个声部到达根音，先行导音越八度", progression.replace("D#4/4 E4/4", "D#4/4 E5/4")],
    ["增和弦三音越八度落主音", progression.replace("G#2/4 A2/4", "G#2/4 A3/4")],
    ["先行属七的七音未在原音区解决", progression.replace("B2/4 G#2/4 A2/4", "A2/4 G#3/4 A3/4")],
    ["中间和弦标注与实奏冲突", progression + "\nannotations {\n chord other range=[1:2,1:3) symbol=IV\n}"],
  ])("%s 时缺少完整的局部属解决链", (_label, text) => {
    expect(hasWarning(text)).toBe(false);
  });
});
