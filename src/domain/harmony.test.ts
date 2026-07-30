import { describe, expect, it } from "vitest";
import { checkHarmony } from "./harmony";
import { defaultHarmonyRuleSeverities } from "./harmonyRules";
import {
  createEmptyProject,
  PPQ,
  type ChordAnalysis,
  type NoteEvent,
  type VoiceId,
} from "./model";

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

function addLine(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  pitches: number[],
) {
  project.tracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (midiNote, index) =>
      note(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
  );
}

function addChord(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  index: number,
  analysis: ChordAnalysis,
) {
  project.chordTrack.regions.push({
    id,
    startTick: index * PPQ,
    durationTicks: PPQ,
    analysis,
    locked: false,
  });
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

  it("同和弦转换仍检查平行八度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: ChordAnalysis = {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-root", 0, tonic);
    addChord(project, "tonic-second-inversion", 1, {
      ...tonic,
      inversion: 2,
    });
    addPair(project, "soprano", [72, 79]);
    addPair(project, "bass", [48, 55]);

    expect(ruleIds(project)).toContain("parallel-octaves");
  });

  it("同和弦转换仍检查声部交叉", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: ChordAnalysis = {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-1", 0, tonic);
    addChord(project, "tonic-2", 1, tonic);
    addPair(project, "soprano", [72, 67]);
    addPair(project, "alto", [67, 72]);

    expect(ruleIds(project)).toContain("voice-crossing");
  });

  it("同和弦转换放宽八度内大跳与声部超越", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: ChordAnalysis = {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-1", 0, tonic);
    addChord(project, "tonic-2", 1, tonic);
    addPair(project, "soprano", [67, 76]);
    addPair(project, "alto", [64, 72]);

    const ids = ruleIds(project);
    expect(ids).not.toContain("melodic-large-leap");
    expect(ids).not.toContain("voice-overlap");
  });

  it("同和弦转换放宽外声部隐伏完全协和音程", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: ChordAnalysis = {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-root", 0, tonic);
    addChord(project, "tonic-second-inversion", 1, {
      ...tonic,
      inversion: 2,
    });
    addPair(project, "soprano", [64, 67]);
    addPair(project, "bass", [48, 55]);

    expect(ruleIds(project)).not.toContain("hidden-perfect-interval");
  });

  it("同一七和弦内的三全音分解不触发旋律警告", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const dominantSeventh: ChordAnalysis = {
      degree: 5,
      accidental: 0,
      quality: "dominant7",
      inversion: 0,
    };
    addChord(project, "dominant-7-1", 0, dominantSeventh);
    addChord(project, "dominant-7-2", 1, dominantSeventh);
    addPair(project, "soprano", [71, 65]);

    expect(ruleIds(project)).not.toContain("melodic-tritone");
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

  it("同和弦连续转换后再检查导音解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominant: ChordAnalysis = {
      degree: 5,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, { ...dominant, inversion: 1 });
    addChord(project, "tonic", 2, {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 59, 60]);

    expect(ruleIds(project)).not.toContain("leading-tone-resolution");
  });

  it("离开同和弦后导音仍未解决时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominant: ChordAnalysis = {
      degree: 5,
      accidental: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, dominant);
    addChord(project, "tonic", 2, {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 59, 57]);

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "leading-tone-resolution",
    );
    expect(diagnostic?.tick).toBe(PPQ * 2);
  });

  it("和弦性质变化不作为同和弦转换", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addChord(project, "dominant", 0, {
      degree: 5,
      accidental: 0,
      quality: "major",
      inversion: 0,
    });
    addChord(project, "dominant-seventh", 1, {
      degree: 5,
      accidental: 0,
      quality: "dominant7",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 59]);

    expect(ruleIds(project)).toContain("leading-tone-resolution");
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

  it("同一七和弦转换结束后再检查七音解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominantSeventh: ChordAnalysis = {
      degree: 5,
      accidental: 0,
      quality: "dominant7",
      inversion: 0,
    };
    addChord(project, "dominant-7-1", 0, dominantSeventh);
    addChord(project, "dominant-7-2", 1, {
      ...dominantSeventh,
      inversion: 2,
    });
    addChord(project, "tonic", 2, {
      degree: 1,
      accidental: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "alto", [65, 65, 64]);

    expect(ruleIds(project)).not.toContain("chord-seventh-resolution");
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

  it("同和弦转换中临时缺音与重复导音在最终恢复时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions.push({
      id: "dominant",
      startTick: 0,
      durationTicks: PPQ * 3,
      analysis: {
        degree: 5,
        accidental: 0,
        quality: "major",
        inversion: 0,
      },
      locked: false,
    });
    addLine(project, "soprano", [74, 79, 74]);
    addLine(project, "alto", [71, 71, 71]);
    addLine(project, "tenor", [67, 59, 67]);
    addLine(project, "bass", [43, 43, 43]);

    const ids = ruleIds(project);
    expect(ids).not.toContain("chord-completeness");
    expect(ids).not.toContain("leading-tone-doubling");
  });

  it("同和弦转换结束时仍缺音或重复导音继续给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions.push({
      id: "dominant",
      startTick: 0,
      durationTicks: PPQ * 3,
      analysis: {
        degree: 5,
        accidental: 0,
        quality: "major",
        inversion: 0,
      },
      locked: false,
    });
    addLine(project, "soprano", [74, 79, 79]);
    addLine(project, "alto", [71, 71, 71]);
    addLine(project, "tenor", [67, 59, 59]);
    addLine(project, "bass", [43, 43, 43]);

    const ids = ruleIds(project);
    expect(ids).toContain("chord-completeness");
    expect(ids).toContain("leading-tone-doubling");
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

  it("副属和弦重复转换后再检查目标解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const secondaryDominant: ChordAnalysis = {
      degree: 5,
      accidental: 0,
      quality: "major",
      inversion: 0,
      appliedToDegree: 2,
    };
    addChord(project, "secondary-dominant-1", 0, secondaryDominant);
    addChord(project, "secondary-dominant-2", 1, {
      ...secondaryDominant,
      inversion: 1,
    });
    addChord(project, "supertonic", 2, {
      degree: 2,
      accidental: 0,
      quality: "minor",
      inversion: 0,
    });

    expect(ruleIds(project)).not.toContain("secondary-dominant-resolution");
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
