import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project";
import { buildHarmonyAnalysis } from "../../analysis";
import { applyHarmonyInference, inferHarmony } from "../../inference/harmonyInference";
import { checkHarmony } from "../../registry";

const root = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | F5/2 E5/4 |
 A: | A4/4 G4/2 |
 T: | C4/4 B3/4 E4/4 |
 B: | F3/4 G3/4 C3/4 |
 H: | S/4 D7/4 T/4 |
}`;

const labelOnly = root.replace("A4/4 G4/2", "A4/2 G4/4")
  .replace("C4/4 B3/4 E4/4", "C4/2 E4/4").replace("F3/4 G3/4 C3/4", "F3/2 C3/4");

const applied = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2 B4/4 |
 A: | E4/4 D4/2 |
 T: | G3/4 A3/4 B3/4 |
 B: | C3/4 F#3/4 G3/4 |
 H: | T/4 V65/V/4 V/4 |
}`;

const neighbor = `satb 1
key Ab major
meter 2/4
bars 1..3 {
 S: | Ab4/2~ | Ab4/8 Bbb4/8 Ab4/4 | G4/2 |
 A: | Cb4/2 | Db4/2 | Db4/2 |
 T: | Ab3/2 | Fb3/2 | G3/2 |
 B: | Fb2/2 | Bbb2/2 | Eb3/2 |
 H: | bVI/2 | bII7/8 bII/8 bII7/4 | V7/2 |
}`;

function seventhWarnings(project: ProjectDocument) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.chord-seventh");
}

function atExit(text: string, voice: string, expected: number) {
  const { project } = compileScoreText(text);
  const warnings = seventhWarnings(project);
  expect(warnings).toHaveLength(expected);
  if (expected) {
    expect(warnings[0]).toMatchObject({
      tick: 2 * project.ppq,
      voiceIds: [voice],
      debug: { obligation: { openedAt: { tick: project.ppq } } },
    });
  }
}

describe("七音从上一和弦的实写成员持续进入", () => {
  it.each([[root, 0], [root.replace("E5/4", "G5/4"), 1]] as const)(
    "复核 14–191 省五属七的准备音和主和弦着陆", (text, expected) => {
      atExit(text, "soprano", expected);
      const { project } = compileScoreText(text.replace(/\n H:.*/, ""));
      const written = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
      const slices = buildHarmonyAnalysis(written).slices;
      expect(slices.find(slice => slice.tick === 0)?.chord?.identity.root).toMatchObject({ step: "F", alter: 0 });
      expect(slices.find(slice => slice.tick === project.ppq)?.chord?.identity).toMatchObject({
        root: { step: "G", alter: 0 }, structure: { quality: "dominant7" },
      });
      expect(slices.find(slice => slice.tick === 2 * project.ppq)?.chord?.identity.root)
        .toMatchObject({ step: "C", alter: 0 });
      expect(seventhWarnings(written)).toHaveLength(expected);
    },
  );

  it("同音重奏仍走原来的起奏入口", () => {
    atExit(root.replace("F5/2 E5/4", "F5/4 F5/4 G5/4"), "soprano", 1);
  });

  it.each([[applied, 0], [applied.replace("B4/4", "D5/4"), 1]] as const)(
    "副属七的 D/F♯ 转位保留七音义务", (text, expected) => {
      atExit(text, "soprano", expected);
    },
  );

  it("属二的低音从下属根音保持，按实奏处理低音解决", () => {
    const text = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | A4/4 B4/4 C5/2 |
 A: | F4/4 G4/4 G4/2 |
 T: | C4/4 D4/4 C4/2 |
 B: | F3/2 E3/2 |
 H: | S/4 D2/4 T6/2 |
}`;
    // 15–208，左。错误版也保留一个完整的着陆和弦。
    atExit(text, "bass", 0);
    atExit(text.replace("G4/4 G4/2", "G4/4 E4/2").replace("E3/2", "G3/2").replace("T6/2", "I64/2"), "bass", 1);
  });

  it("持音开立后仍执行同根换位中禁止的七音交接", () => {
    const text = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | A4/4 B4/4 F4/4 |
 A: | F4/4 G4/4 D4/4 |
 T: | C4/4 D4/4 B3/4 |
 B: | F3/2 G3/4 |
 H: | S/4 D2/4 D7/4 |
}`;
    atExit(text, "bass", 1);
    expect(seventhWarnings(compileScoreText(text).project)[0]?.title).toBe("属七和弦换位时低音七音上行");
  });

  it.each(["label", "inversion", "reattack"])("同七音过切片或转位重写，只结算一次（%s）", variant => {
    const reinvert = variant === "inversion";
    const text = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${variant === "reattack" ? "F5/2 F5/4" : "F5/2."} G5/4 |
 A: | A4/4 G4/2 G4/4 |
 T: | C4/4 ${reinvert ? "B3/4 D4/4" : "B3/2"} E4/4 |
 B: | F3/4 ${reinvert ? "G3/4 B3/4" : "G3/2"} C3/4 |
 H: | S/4 D7/4 ${reinvert ? "D65/4" : "D7/4"} T/4 |
}`;
    const { project } = compileScoreText(text);
    const warnings = seventhWarnings(project);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      tick: 3 * project.ppq, debug: { obligation: { openedAt: { tick: project.ppq } } },
    });
  });

  it.each([
    ["只是改标签", labelOnly],
    ["把实写七音写成等音 E♯", root.replace("F5/2", "E#5/2")],
    ["前置和弦的三音错拼为等音", root.replace("A4/4", "G##4/4")],
    ["新和弦的结构三音错拼为等音", root.replace("B3/4", "Cb4/4")],
    ["旧和弦外音", root.replace("H: | S/4", "H: | T/4")],
    ["音符已标外音", root + "\nannotations {\nnote S@1:1 role=suspension\n}"],
    ["缺七和弦的实写三音", root.replace("B3/4 E4/4", "D4/4 E4/4")],
  ])("%s 时没有足够的持音开立证据", (_name, text) => {
    atExit(text.replace("E5/4", "G5/4"), "soprano", 0);
  });

  it("手工句界与未知后继保持原有边界", () => {
    const { project } = compileScoreText(root.replace("E5/4", "G5/4"));
    const cut = { id: "new-phrase", tick: project.ppq, source: "manual", confidence: "certain" } as const;
    expect(seventhWarnings({ ...project, structure: { ...project.structure, phraseBoundaries: [cut] } })).toEqual([]);
    expect(seventhWarnings({ ...project, chordTrack: { ...project.chordTrack, regions: project.chordTrack.regions.slice(0, 2) } })).toEqual([]);
  });

  it("同调重申伴随真实和声变化时仍可开立", () => {
    const { project } = compileScoreText(root.replace("E5/4", "G5/4"));
    project.keyEvents.push({ ...project.keyEvents[0], id: "restated-key", tick: project.ppq });
    expect(seventhWarnings(project)).toMatchObject([{ tick: 2 * project.ppq, voiceIds: ["soprano"] }]);
  });

  it.each([["同调重申但无运动", labelOnly, "major"], ["实际变调", root, "minor"]] as const)(
    "调号事件并不提供持音开立证据（%s）", (_label, text, mode) => {
      const { project } = compileScoreText(text.replace("E5/4", "G5/4"));
      project.keyEvents.push({ ...project.keyEvents[0], mode, id: "new-key-event", tick: project.ppq });
      expect(seventhWarnings(project)).toEqual([]);
    },
  );

  it("下属六五的持音七音转为主根时仍可同音解决", () => {
    const text = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2. |
 A: | G4/4 A4/4 G4/4 |
 T: | E4/4 D4/4 E4/4 |
 B: | C3/4 F3/4 C3/4 |
 H: | T/4 SII65/4 T/4 |
}`;
    atExit(text, "soprano", 0);
    atExit(text.replace("C5/2.", "C5/2 G5/4"), "soprano", 1);
  });

  const annotatedNeighbor = neighbor.replace("Bbb4/8", "Bbb4/8@ornament") +
    "\nannotations {\nnote ornament role=neighbor\n}";
  it.each([["未标记", neighbor], ["明确标记", annotatedNeighbor]])(
    "N074 型回到同一七音时延后结算（%s）", (_label, text) => {
      const legal = compileScoreText(text).project;
      const ornament = legal.satbTracks.find(track => track.id === "soprano")?.notes
        .find(note => note.startTick === 2.5 * legal.ppq);
      expect(ornament?.nonChordToneRole).toBe(text === annotatedNeighbor ? "neighbor" : undefined);
      expect(seventhWarnings(legal)).toEqual([]);
      const wrong = compileScoreText(text.replace("Ab4/4 | G4/2", "Ab4/4 | Bb4/2")).project;
      const warnings = seventhWarnings(wrong);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        tick: 4 * wrong.ppq,
        debug: { obligation: { steps: expect.arrayContaining([
          expect.objectContaining({ reason: "chord-seventh-prepared-neighbor", outcome: "continue" }),
        ]) } },
      });
    },
  );

  it.each([2.25, 2.75])("同调重申切分持续音时仍在真正离开七音处结算（%s）", beat => {
    for (const [landing, exits] of [["G4", []], ["Bb4", [4]]] as const) {
      const { project } = compileScoreText(annotatedNeighbor.replace("G4/2 |", landing + "/2 |"));
      project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
      expect(seventhWarnings(project).map(item => item.tick / project.ppq)).toEqual(exits);
    }
  });

  it.each(["key", "phrase"] as const)("真实调性或乐句变化中止辅助音延后结算（%s）", type => {
    const { project } = compileScoreText(annotatedNeighbor);
    const tick = 2.75 * project.ppq;
    if (type === "key") {
      project.keyEvents.push(
        { ...project.keyEvents[0], id: "change", mode: "minor", tick },
        { ...project.keyEvents[0], id: "restore", tick: 3 * project.ppq },
      );
    } else {
      project.structure.phraseBoundaries.push({ id: "new-phrase", source: "manual", confidence: "certain", tick });
    }
    expect(seventhWarnings(project)).toMatchObject([{ tick: 2.5 * project.ppq, voiceIds: ["soprano"] }]);
  });

  it.each([
    ["缺回归", neighbor.replace("Bbb4/8 Ab4/4", "Bbb4/4.").replace("bII/8 bII7/4", "bII/4.")],
    ["标注辅助音仍须实际回归", annotatedNeighbor.replace("Bbb4/8@ornament Ab4/4", "Bbb4/4.@ornament")
      .replace("bII/8 bII7/4", "bII/4.")],
    ["等音并非实写级进", neighbor.replace("Bbb4/8", "A4/8")],
    ["明文标为倚音", annotatedNeighbor.replace("role=neighbor", "role=appoggiatura")],
  ])("近似谱面仍在出发处结算（%s）", (_label, text) => {
    const { project } = compileScoreText(text);
    expect(seventhWarnings(project)).toMatchObject([{ tick: 2.5 * project.ppq, voiceIds: ["soprano"] }]);
  });
});
