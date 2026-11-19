import { describe, expect, it } from "vitest";
import type { ProjectDocument, VoiceId } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const rootPosition = {
  soprano: "D5 C5", alto: "G4 E4", tenor: "B3 A3", bass: "G2 A2", harmony: "D TSVI",
};
const firstInversion = {
  soprano: "D5 E5", alto: "G4 C5", tenor: "D4 C4", bass: "B3 A3", harmony: "D6 TSVI",
};

function pair({
  soprano, alto, tenor, bass, harmony,
  key = "C major",
  beatLengths = ["4", "4"],
}: typeof rootPosition & { key?: string; beatLengths?: string[] }) {
  const durations = (notes: string) => notes.split(" ").map((note, i) => `${note}/${beatLengths[i]}`).join(" ");
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${durations(soprano)} |
 A: | ${durations(alto)} |
 T: | ${durations(tenor)} |
 B: | ${durations(bass)} |
 ${harmony ? `H: | ${durations(harmony)} |` : ""}
}`).project;
}

function leadingWarning(project: ProjectDocument, voice: VoiceId, tick: number = project.ppq) {
  return checkHarmony(project).diagnostics.some(item =>
    item.ruleId === "resolution.leading-tone" && item.tick === tick &&
    item.severity === "warning" && item.voiceIds.includes(voice));
}

describe("E.1 大调阻碍进行中的导音下行", () => {
  it.each([
    ["原位 D 的男高", rootPosition, "tenor"],
    ["原位 D 的女低", { soprano: "D5 C5", alto: "B4 A4", tenor: "G3 E3", bass: "G2 A2", harmony: "D TSVI" }, "alto"],
    ["D6 的低音", firstInversion, "bass"],
    ["移调至降 B 大调", {
      key: "Bb major", soprano: "C5 Bb4", alto: "F4 D4", tenor: "A3 G3", bass: "F2 G2", harmony: "D TSVI",
    }, "tenor"],
  ] as const)("%s 仅在有和声证据时放行", (_description, voicing, voice) => {
    expect(leadingWarning(pair(voicing), voice)).toBe(false);
    expect(leadingWarning(pair({ ...voicing, harmony: "" }), voice)).toBe(true);
  });

  it("D6 重根、在第二拍到第三拍进行也可放行", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | E4/4 G4/4 C5/4 |
 A: | C4/4 D4/4 C4/4 |
 T: | G3/4 G3/4 E3/4 |
 B: | C3/4 B2/4 A2/4 |
 H: | T/4 D6/4 TSVI/4 |
}`);
    expect(leadingWarning(project, "bass", 2 * project.ppq)).toBe(false);
  });

  it.each([
    ["女高导音下行", { ...rootPosition, soprano: "B4 A4", alto: "D4 E4", tenor: "G3 C4" }, "soprano"],
    ["目标为普通下属和弦且导音同样下大二度", {
      ...rootPosition, soprano: "D5 C5", alto: "G4 F4", tenor: "B3 A3", bass: "G2 F2", harmony: "D S",
    }, "tenor"],
    ["B3 跌至低八度的 A", { ...rootPosition, tenor: "B3 A2" }, "tenor"],
    ["B3 下行到与 A 同音的重升 G", { ...rootPosition, tenor: "B3 G##3" }, "tenor"],
    ["VI 标签下实奏缺三音", { ...rootPosition, soprano: "D5 E5" }, "tenor"],
    ["VI 转位标签与实际低音冲突", { ...rootPosition, harmony: "D TSVI6" }, "tenor"],
    ["标为原位 D 但实际由导音作低音", { ...firstInversion, harmony: "D TSVI" }, "bass"],
    ["只有三声部", { ...rootPosition, alto: "r E4" }, "tenor"],
    ["名义男高低于实际低音", { ...rootPosition, tenor: "B2 A2", bass: "G3 A3" }, "tenor"],
    ["D6→VI 实写重复根音", { ...firstInversion, tenor: "D4 A4" }, "bass"],
    ["原位 D→VI 配置齐全但平行五度", { ...rootPosition, soprano: "D5 E5", alto: "G4 C5" }, "tenor"],
  ] as const)("%s 时仍应报警", (_description, voicing, voice) => {
    expect(leadingWarning(pair(voicing), voice)).toBe(true);
  });

  it("普通 D→T 内声从 B3 错走到实际主和弦三音 E3，三种输入仍报警", () => {
    const voicing = { soprano: "D5 G5", alto: "G4 C5", tenor: "B3 E3", bass: "G2 C3", harmony: "D T" };
    const bare = pair({ ...voicing, harmony: "" });
    const blind = applyHarmonyInference(bare, { chordInference: inferChords(bare) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(blind.chordTrack.regions.map(region => region.startTick)).toEqual([0, blind.ppq]);
    for (const project of [bare, blind, pair(voicing)]) {
      expect(leadingWarning(project, "tenor")).toBe(true);
    }
  });

  it("落在拍内分割点的进行不借用此例外", () => {
    const project = pair({ ...rootPosition, beatLengths: ["8", "4."] });
    expect(leadingWarning(project, "tenor", project.ppq / 2)).toBe(true);
  });

  it("人工句界可阻断这条义务的取证", () => {
    const project = pair(firstInversion);
    project.structure.phraseBoundaries.push({
      id: "manual", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(leadingWarning(project, "bass")).toBe(true);
  });

  it.each([
    ["男高", { soprano: "B4 A4", alto: "E4 C4", tenor: "G#3 F3", bass: "E2 F2", harmony: "D TSVI" }, "tenor"],
    ["女低", { soprano: "E5 C5", alto: "G#4 F4", tenor: "B3 A3", bass: "E3 F3", harmony: "D TSVI" }, "alto"],
    ["低音", { soprano: "B4 C5", alto: "E4 A4", tenor: "B3 A3", bass: "G#3 F3", harmony: "D6 TSVI" }, "bass"],
  ] as const)("小调%s下行增二度在裸音和给和弦时均报警", (_description, voicing, voice) => {
    expect(leadingWarning(pair({ ...voicing, key: "A minor" }), voice)).toBe(true);
    expect(leadingWarning(pair({ ...voicing, key: "A minor", harmony: "" }), voice)).toBe(true);
  });
});
