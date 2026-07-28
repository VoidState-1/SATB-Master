import { describe, expect, it } from "vitest";
import { checkHarmony } from "./harmony";
import { defaultHarmonyRuleSeverities } from "./harmonyRules";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "./model";

function addPair(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  pitches: [number, number],
) {
  project.tracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (midiNote, index) => ({
      id: `${voiceId}-${index}`,
      startTick: index * PPQ,
      durationTicks: PPQ,
      midiNote,
      velocity: 88,
      locked: false,
    }),
  );
}

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  midiNote: number,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    midiNote,
    velocity: 88,
    locked: false,
  };
}

function ruleIds(project: ReturnType<typeof createEmptyProject>) {
  return checkHarmony(project).diagnostics.map((item) => item.ruleId);
}

describe("斯波索宾基础规则检查", () => {
  it("识别两个声部同向形成的连续纯五度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);
    addPair(project, "bass", [48, 50]);

    const result = checkHarmony(project);
    expect(
      result.diagnostics.some(
        (item) => item.ruleId === "parallel-fifths" && item.tick === PPQ,
      ),
    ).toBe(true);
  });

  it("使用规则配置改写诊断严重度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);
    addPair(project, "bass", [48, 50]);
    const severities = defaultHarmonyRuleSeverities();
    severities["parallel-fifths"] = "suggestion";

    const diagnostic = checkHarmony(project, severities).diagnostics.find(
      (item) => item.ruleId === "parallel-fifths",
    );
    expect(diagnostic?.severity).toBe("suggestion");
  });

  it("严重度为无时关闭该规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);
    addPair(project, "bass", [48, 50]);
    const severities = defaultHarmonyRuleSeverities();
    severities["parallel-fifths"] = "off";

    expect(
      checkHarmony(project, severities).diagnostics.map((item) => item.ruleId),
    ).not.toContain("parallel-fifths");
  });

  it("和弦轨为空时明确跳过依赖和弦标注的规则", () => {
    const result = checkHarmony(createEmptyProject());
    expect(result.skippedRuleIds).toEqual(
      expect.arrayContaining([
        "chord-membership",
        "chord-completeness",
        "chord-inversion",
        "leading-tone-doubling",
        "chord-seventh-resolution",
      ]),
    );
  });

  it("已关闭的和弦规则不计入跳过统计", () => {
    const severities = defaultHarmonyRuleSeverities();
    severities["chord-membership"] = "off";

    expect(
      checkHarmony(createEmptyProject(), severities).skippedRuleIds,
    ).not.toContain("chord-membership");
  });

  it("识别同一声部内时间重叠的音符", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.tracks[0].notes = [
      note("s-0", 0, PPQ, 67),
      note("s-1", PPQ / 2, PPQ, 69),
    ];

    expect(ruleIds(project)).toContain("voice-note-overlap");
  });

  it("相邻但不重叠的同声部音符不触发重叠规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);

    expect(ruleIds(project)).not.toContain("voice-note-overlap");
  });

  it("大调导音上行到主音时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [71, 72]);

    expect(ruleIds(project)).not.toContain("leading-tone-resolution");
  });

  it("连续导音未上行到主音时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [71, 69]);

    expect(ruleIds(project)).toContain("leading-tone-resolution");
  });

  it("小调自然七级不被误判为升高导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents[0] = { ...project.keyEvents[0], tonic: 0, mode: "minor" };
    addPair(project, "soprano", [70, 68]);

    expect(ruleIds(project)).not.toContain("leading-tone-resolution");
  });

  it("换调边界不沿用旧调导音解决要求", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents.push({ id: "key-d", tick: PPQ, tonic: 2, mode: "major" });
    addPair(project, "soprano", [71, 69]);

    expect(ruleIds(project)).not.toContain("leading-tone-resolution");
  });

  it("七和弦七音级进下行解决时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push({
      id: "g7",
      startTick: 0,
      durationTicks: PPQ,
      analysis: {
        degree: 5,
        accidental: 0,
        quality: "dominant7",
        inversion: 0,
      },
      locked: false,
    });
    addPair(project, "alto", [65, 64]);

    expect(ruleIds(project)).not.toContain("chord-seventh-resolution");
  });

  it("七和弦七音未级进下行时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push({
      id: "g7",
      startTick: 0,
      durationTicks: PPQ,
      analysis: {
        degree: 5,
        accidental: 0,
        quality: "dominant7",
        inversion: 0,
      },
      locked: false,
    });
    addPair(project, "alto", [65, 67]);

    expect(ruleIds(project)).toContain("chord-seventh-resolution");
  });

  it("检查和弦区域后半段的和弦外音并关联区域", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push({
      id: "c-major",
      startTick: 0,
      durationTicks: PPQ * 2,
      analysis: { degree: 1, accidental: 0, quality: "major", inversion: 0 },
      locked: false,
    });
    project.tracks[0].notes = [
      note("inside", 0, PPQ, 72),
      note("outside", PPQ, PPQ, 74),
    ];

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord-membership",
    );
    expect(diagnostic).toMatchObject({
      tick: PPQ,
      endTick: PPQ * 2,
      chordIds: ["c-major"],
      noteIds: ["outside"],
    });
  });

  it("人工标注非和弦音角色后不再重复报警", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions.push({
      id: "c-major",
      startTick: 0,
      durationTicks: PPQ,
      analysis: { degree: 1, accidental: 0, quality: "major", inversion: 0 },
      locked: false,
    });
    project.tracks[0].notes = [
      { ...note("passing", 0, PPQ, 74), nonChordToneRole: "passing" },
    ];

    expect(ruleIds(project)).not.toContain("chord-membership");
  });

  it("和弦构成音不完整只关联和弦区域", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions.push({
      id: "c-major",
      startTick: 0,
      durationTicks: PPQ,
      analysis: { degree: 1, accidental: 0, quality: "major", inversion: 0 },
      locked: false,
    });
    project.tracks[0].notes = [note("soprano-c", 0, PPQ, 72)];
    project.tracks[1].notes = [note("alto-g", 0, PPQ, 67)];
    project.tracks[2].notes = [note("tenor-c", 0, PPQ, 60)];
    project.tracks[3].notes = [note("bass-c", 0, PPQ, 48)];

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord-completeness",
    );
    expect(diagnostic).toMatchObject({
      chordIds: ["c-major"],
      voiceIds: [],
      noteIds: [],
    });
  });

  it("按斯波索宾基础功能序进提示属到下属的逆功能进行", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      {
        id: "dominant",
        startTick: 0,
        durationTicks: PPQ,
        analysis: { degree: 5, accidental: 0, quality: "major", inversion: 0 },
        locked: false,
      },
      {
        id: "subdominant",
        startTick: PPQ,
        durationTicks: PPQ,
        analysis: { degree: 4, accidental: 0, quality: "major", inversion: 0 },
        locked: false,
      },
    );

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "functional-retrogression",
    );
    expect(diagnostic?.chordIds).toEqual(["dominant", "subdominant"]);
    expect(diagnostic?.severity).toBe("warning");
  });

  it("空白区间会中断功能进行判断", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions.push(
      {
        id: "dominant",
        startTick: 0,
        durationTicks: PPQ,
        analysis: { degree: 5, accidental: 0, quality: "major", inversion: 0 },
        locked: false,
      },
      {
        id: "subdominant",
        startTick: PPQ * 2,
        durationTicks: PPQ,
        analysis: { degree: 4, accidental: 0, quality: "major", inversion: 0 },
        locked: false,
      },
    );

    expect(ruleIds(project)).not.toContain("functional-retrogression");
  });
});
