import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  annotations?: string;
}

function fixture({
  soprano = "D5/1 | C5/1",
  alto = "B4/1 | G4/1",
  tenor = "F4/1@sus~ | F4/4 E4/2.",
  bass = "G3/1 | C3/1",
  harmony = "V7/1 | I/1",
  annotations = "",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}
${annotations ? "annotations {\n" + annotations + "\n}" : ""}`).project;
}

function unclassified(project: ReturnType<typeof fixture>) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.unclassified-nonchord-tone")
    .map(({ tick, endTick, voiceIds }) => ({ tick: tick / project.ppq, endTick: endTick / project.ppq, voiceIds }));
}

describe("有准备的延留只在已证实的当前和弦区间生效", () => {
  it("同一延音事件上的 4–3 和有证据的双重延留通过默认入口", () => {
    const single = fixture();
    expect(unclassified(single)).toEqual([]);
    expect(unclassified(fixture({ soprano: "D5/1~ | D5/4 C5/2." }))).toEqual([]);
    expect(single.satbTracks.find(track => track.voice === "tenor")!.notes[0].nonChordToneRole).toBeUndefined();
  });

  const appliedNinth: Example = {
    soprano: "E5/1~ | E5/4 D5/2.", alto: "G4/1 | F#4/1",
    tenor: "C4/1 | A3/1", bass: "C3/1 | D3/1", harmony: "I/1 | V/V/1",
  };

  it.each([
    ["副属大三和弦", appliedNinth],
    ["第二级小三和弦", { ...appliedNinth, alto: "G4/1 | F4/1", harmony: "I/1 | ii/1" }],
  ] as const)("单 9–8 可解决到%s", (_name, example) => {
    const project = fixture(example);
    expect(project.chordTrack.regions).toHaveLength(2);
    expect(unclassified(project)).toEqual([]);
    expect(project.satbTracks.flatMap(t => t.notes).every(n => !n.nonChordToneRole)).toBe(true);
  });

  it.each<[string, Example]>([
    ["准备标签与当时实音不合", { ...appliedNinth, harmony: "vi/1 | V/V/1" }],
    ["解决前被重新起奏", { ...appliedNinth, soprano: "E5/1 | E5/4 D5/2." }],
    ["解决落在七和弦上", { ...appliedNinth, harmony: "I/1 | V7/V/1" }],
    ["解决后只有根、三音", { ...appliedNinth, tenor: "C4/1 | D4/1" }],
    ["低音不在解决和弦的根音上", { ...appliedNinth, bass: "C3/1 | F#3/1" }],
  ])("%s 时单九音不获豁免", (_name, example) => {
    expect(unclassified(fixture(example))).toContainEqual(expect.objectContaining({
      tick: 4, voiceIds: expect.arrayContaining(["soprano"]),
    }));
  });

  it("单九音仅豁免延留区间，保留准备以前和解决以后的外音", () => {
    const project = fixture({
      soprano: "E5/1~ | E5/4 D5/4 G5/2", alto: "G4/1 | F#4/1",
      tenor: "B3/2 C4/2 | A3/1", bass: "G3/2 C3/2 | D3/1",
      harmony: "V/2 I/2 | V/V/1",
    });
    expect(unclassified(project)).toEqual([
      { tick: 0, endTick: 2, voiceIds: ["soprano"] },
      { tick: 6, endTick: 8, voiceIds: ["soprano"] },
    ]);
  });

  it("保留解决之后同一主和弦上的其他未解释外音", () => {
    expect(unclassified(fixture({ soprano: "D5/1 | C5/2 F5/2" }))).toEqual([
      { tick: 6, endTick: 8, voiceIds: ["soprano"] },
    ]);
  });

  it("同一切片另有未解决外音时保留警告及两个声部", () => {
    expect(unclassified(fixture({ alto: "B4/1 | A#4/1" }))).toContainEqual({
      tick: 4, endTick: 5, voiceIds: ["alto", "tenor"],
    });
  });

  it("解决落在另一个同身份、同功能的主和弦区域时仍可核实", () => {
    expect(unclassified(fixture({ harmony: "V7/1 | I/4 I/2." }))).toEqual([]);
  });

  it("同一主和弦标签在延留区间内拆开时仍核对完整的延留", () => {
    expect(unclassified(fixture({ harmony: "V7/1 | I/8 I/8 I/2." }))).toEqual([]);
  });

  it("延留区间内有冲突转位时，两处外音都应报告", () => {
    expect(unclassified(fixture({ harmony: "V7/1 | I/8 I6/8 I/2." }))).toEqual([
      { tick: 4, endTick: 4.5, voiceIds: ["tenor"] },
      { tick: 4.5, endTick: 5, voiceIds: ["tenor"] },
    ]);
  });

  it("同身份落点的解释换了局部调时仍报", () => {
    expect(unclassified(fixture({
      harmony: "V7/1 | I/4 r/2.",
      annotations: 'chord exit range=[2:2,3:1) symbol=IV localKey="G major"',
    }))).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
  });

  it("即使局部解释相同，跨书写调号边界也仍报", () => {
    const project = fixture({ harmony: "V7/1 | I/4 I/2." });
    const tonic = { step: "C", alter: 0 } as const;
    const localKey = { tonic, mode: "major" } as const;
    for (const chord of project.chordTrack.regions) chord.semantics!.interpretations[0].localKey = localKey;
    project.keyEvents.push({
      id: "changed-key", tick: 5 * project.ppq, tonic: { step: "G", alter: 0 }, mode: "major",
    });
    expect(unclassified(project)).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
  });

  it("弱位上声部短暂变音时，按实音核对准备并保留该弱位警告", () => {
    const soprano = "D5/2.. E5/8 | C5/1";
    expect(unclassified(fixture({ soprano }))).toEqual([
      { tick: 3.5, endTick: 4, voiceIds: ["soprano"] },
    ]);
    expect(unclassified(fixture({ soprano, harmony: "V7/2.. r/8 | I/1" }))).toEqual([]);
    expect(unclassified(fixture({ soprano, harmony: "V7/2.. I64/8 | I/1" })))
      .toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
  });

  it("同一事件在较早和弦有真实外音时，整音角色会遮掉该警告", () => {
    const example = {
      soprano: "C5/2 D5/2 | C5/1",
      alto: "G4/2 B4/2 | G4/1",
      bass: "C3/2 G3/2 | C3/1",
      harmony: "I/2 V7/2 | I/1",
    };
    expect(unclassified(fixture(example))).toEqual([{ tick: 0, endTick: 2, voiceIds: ["tenor"] }]);
    const tagged = fixture({ ...example, annotations: "note sus role=suspension" });
    expect(unclassified(tagged)).toEqual([]);
    expect(checkHarmony(tagged).diagnostics).toContainEqual(expect.objectContaining({
      tick: 0, ruleId: "nonchord.suspension-preparation",
    }));
  });

  it("保留原有显式挂留角色校验", () => {
    const project = fixture({
      tenor: "F4/1@sus~ | F4/4 G4/2.",
      annotations: "note sus role=suspension",
    });
    expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "nonchord.suspension-resolution",
    }));
  });

  it.each(["suspension", "other"])("保留显式 %s 的优先级，未标的 9–8 不随它获豁免", role => {
    expect(unclassified(fixture({
      soprano: "D5/1~ | D5/4 C5/2.",
      annotations: `note sus role=${role}`,
    }))).toEqual([{ tick: 4, endTick: 5, voiceIds: ["soprano"] }]);
  });

  it("解决音已有显式外音角色时不把它当结构解决", () => {
    expect(unclassified(fixture({
      tenor: "F4/1~ | F4/4 E4/2.@arrival",
      annotations: "note arrival role=other",
    }))).toEqual([{ tick: 4, endTick: 5, voiceIds: ["tenor"] }]);
  });

  it("分句横跨准备与延留时保留警告", () => {
    const project = fixture();
    project.structure.phraseBoundaries.push({
      id: "separation", tick: 4 * project.ppq, source: "manual", confidence: "certain",
    });
    expect(unclassified(project)).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
  });

  it.each<[string, Example]>([
    ["未标角色的同拍重奏", { tenor: "F4/1 | F4/4 E4/2." }],
    ["未标角色的同拍起奏且无同音准备", {
      tenor: "G4/1 | F4/4 E4/2.",
      bass: "F3/1 | C3/1",
      harmony: "V42/1 | I/1",
    }],
    ["解决晚于休止", { tenor: "F4/1~ | F4/4 r/8 E4/8 E4/2" }],
    ["原声部反向解决", { tenor: "F4/1~ | F4/4 G4/2." }],
    ["解决音只有等音拼写", { tenor: "F4/1~ | F4/4 Fb4/2." }],
    ["同音低音在解决点重奏", { bass: "G3/1 | C3/4 C3/2." }],
    ["主和弦覆盖在解决前截断", { harmony: "V7/1 | I/4 r/2." }],
    ["主和弦换到另一和声再解决", { harmony: "V7/1 | I/4 vi/2." }],
    ["准备和弦空缺", { harmony: "r/1 | I/1" }],
    ["只有二度而非九度", { tenor: "F4/1 | E4/1", soprano: "D4/1~ | D4/4 C4/2.", bass: "G3/1 | C4/1" }],
    ["九音解决时另一声部也改变", { tenor: "F4/1 | C4/4 E4/2.", soprano: "D5/1~ | D5/4 C5/2." }],
    ["强位完整实奏了替代和弦 F/C", { alto: "B4/1 | A4/4 G4/2." }],
    ["准备后的空白跨过整个弱拍", { soprano: "D5/2. E5/4 | C5/1", harmony: "V7/2. r/4 | I/1" }],
  ])("%s 仍由 D.1 报警", (_label, example) => {
    expect(unclassified(fixture(example))).toContainEqual(expect.objectContaining({ tick: 4 }));
  });
});
