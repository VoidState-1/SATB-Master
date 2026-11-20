import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";
import type { ChordInferenceOptions } from "./types";

const sixFour = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | E5/8 F5/8 E5/4 D5/4 | C5/2. |
  A: | G4/2 G4/4 | G4/2. |
  T: | C4/8 D4/8 C4/4 B3/4 | E4/2. |
  B: | G2/2 G2/4 | C3/2. |
}`;

const dominant = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | D5/8 C#5/8 D5/4 |
  A: | G4/2 |
  T: | B3/8 A#3/8 B3/4 |
  B: | G2/2 |
}`;

const literalRival = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E5/8 F5/8 E5/4 |
  A: | G4/8 A4/8 G4/4 |
  T: | C4/2 |
  B: | C3/2 |
}`;

const enclosure = `satb 1
key G minor
meter 4/4
bars 1..1 {
  S: | Bb4/1 |
  A: | C#4/4 D4/8 B#3/8 C#4/2 |
  T: | E3/4 F3/8 D#3/8 E3/2 |
  B: | G2/1 |
}`;

type Project = ReturnType<typeof compileScoreText>["project"];

function at(project: Project, tick = PPQ / 2, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.find(region =>
    region.fromTick <= tick && tick < region.toTick);
}

const marker = "written-double-neighbor";
function hasDouble(project: Project, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.some(region =>
    region.selected?.evidence.some(evidence => evidence.code === marker));
}

describe("持续低音上的两个同拍辅助音", () => {
  it("从完整强拍识别 K46，并用正常产品入口写回两个辅助音", () => {
    const { project } = compileScoreText(sixFour);
    const selected = at(project);
    expect(selected).toMatchObject({
      fromTick: 0, toTick: 2 * PPQ, status: "resolved",
      selected: {
        functionalBaseId: "K46",
        fit: { nonChordToneAssignments: { "note-S-480": "neighbor", "note-T-480": "neighbor" } },
        evidence: expect.arrayContaining([expect.objectContaining({ code: marker })]),
      },
    });
    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps", writeNonChordToneRoles: true,
    });
    expect(applied.writtenNonChordToneRoleCount).toBe(2);
    expect(applied.project.chordTrack.regions[0]).toMatchObject({
      startTick: 0, durationTicks: 2 * PPQ, semantics: { cadenceRole: "cadential64" },
    });
    expect(checkHarmony(applied.project).diagnostics.some(item =>
      item.tick === PPQ / 2 && item.ruleId === "nonchord.neighbor-tone")).toBe(false);
  });

  it("原位属上的平行十度或同样闭合的反向辅助，可连续覆盖短弱位", () => {
    for (const text of [dominant, dominant.replace("C#5/8", "E5/8")]) {
      const { project } = compileScoreText(text);
      expect(at(project)).toMatchObject({
        fromTick: 0, toTick: 2 * PPQ, status: "resolved",
        selected: { functionalBaseId: "D",
          evidence: expect.arrayContaining([expect.objectContaining({ code: marker })]) },
      });
    }
  });

  it("平行纯五度保持可见，不能借双辅助连续化", () => {
    const text = dominant.replace("C#5/8", "E5/8")
      .replace("G4/2", "B4/2").replace("B3/8 A#3/8 B3/4", "G3/8 A3/8 G3/4");
    const { project } = compileScoreText(text);
    expect(hasDouble(project)).toBe(false);
    const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" });
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.parallel-fifths", tick: PPQ / 2, voiceIds: ["soprano", "tenor"],
    }));
  });
  it("T–实奏下属四六–T 中完整的三和弦照常保留", () => {
    const { project } = compileScoreText(literalRival);
    expect(at(project)?.selected).toMatchObject({
      functionalBaseId: "S", identity: { bass: { step: "C" }, root: { step: "F" } },
      semantics: { cadenceRole: "pedal64" },
    });
    expect(hasDouble(project)).toBe(false);
  });

  it("两拍上下围绕与完整小七音集竞争时不写作两个相邻的普通辅助音", () => {
    const { project } = compileScoreText(enclosure);
    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps", writeNonChordToneRoles: true,
    });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(at(project, 0)?.selected?.identity.structure).toMatchObject({ quality: "diminished7" });
    expect(at(project, 2 * PPQ)?.selected?.identity.structure).toMatchObject({ quality: "diminished7" });
    expect(hasDouble(project)).toBe(false);
  });

  it.each([
    ["低音同音重奏", "G2/2 |", "G2/8 G2/4. |"],
    ["低音跨八度", "G2/2 |", "G2/8 G3/4. |"],
    ["固定内声部重奏", "G4/2 |", "G4/8 G4/4. |"],
    ["不返回原音区", "A#3/8 B3/4", "A#3/8 B4/4"],
    ["用等音异名代替书写级进", "C#5/8", "Db5/8"],
    ["缺第二返回声部", "B3/8 A#3/8 B3/4", "B3/8 r/8 B3/4"],
  ])("%s 时保留原分析", (_label, old, replacement) => {
    const { project } = compileScoreText(dominant.replace(old, replacement));
    expect(hasDouble(project)).toBe(false);
  });

  it("K46 没有真正的属到主闭合时，返回只提供原有候选", () => {
    const text = sixFour.replace("C5/2. |", "D5/2. |").replace("E4/2. |", "B3/2. |")
      .replace("C3/2. |", "G2/2. |");
    const { project } = compileScoreText(text);
    expect(hasDouble(project)).toBe(false);
    expect(at(project)?.status).toBe("unclassified");
  });

  it.each([PPQ / 2, PPQ])("显式句界 %s 截断回证", tick => {
    const { project } = compileScoreText(dominant);
    project.structure.phraseBoundaries = [{ id: "boundary", tick, source: "manual", confidence: "certain" }];
    expect(hasDouble(project)).toBe(false);
  });

  it("重复同一调号事件也不跨事件借回，且尊重产品置信和非和弦音选项", () => {
    const { project } = compileScoreText(dominant);
    expect(hasDouble(project, { minConfidence: "high" })).toBe(false);
    expect(hasDouble(project, { allowNonChordToneCandidates: false })).toBe(false);
    project.keyEvents.push({ ...project.keyEvents[0], id: "split-key", tick: PPQ });
    expect(hasDouble(project)).toBe(false);
  });
});
