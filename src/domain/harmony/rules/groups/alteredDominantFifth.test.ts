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
  it.each([
    ["落点由另一声部代奏", lowered.replace("Db4/4 C4/2", "Db4/4 E4/2")],
    ["错拼落点", lowered.replace("Db4/4 C4/2", "Db4/4 B#3/2")],
    ["隔休止才出现主音", lowered.replace("Db4/4 C4/2", "Db4/8 r/8 C4/2")],
    ["无属三音", lowered.replace("B4/2 C5/2", "A4/2 C5/2")],
    ["后继另成和弦", lowered.replace("F3/2 E3/2", "F3/2 A2/2")],
    ["中间改换和声", lowered.replace("B4/2 C5/2", "B4/4. A4/8 C5/2")],
  ])("%s 时保留原警告", (_why, score) => {
    expect(warnsAtChange(score, "tenor")).toBe(true);
  });
});
