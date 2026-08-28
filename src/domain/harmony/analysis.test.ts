import { describe, expect, it } from "vitest";
import { createChordRegion } from "../chords";
import { checkHarmony } from "./registry";
import { buildHarmonyAnalysis } from "./analysis";
import { formatDiagnosticDebugReport } from "./debug/diagnosticDebug";
import { defaultHarmonyRuleSeverities } from "./rules/catalog";
import {
  createEmptyProject,
  PPQ,
  type ChordDraft,
  type NoteEvent,
  type VoiceId,
} from "../project";
import { spellMidi } from "../pitch";

type TestChordDraft = Omit<ChordDraft, "source" | "confidence"> & {
  source?: ChordDraft["source"];
  confidence?: ChordDraft["confidence"];
};

function testChordDraft(analysis: TestChordDraft): ChordDraft {
  return {
    ...analysis,
    source: analysis.source ?? "manual",
    confidence: analysis.confidence ?? "certain",
  };
}

function chordRegion(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  startTick: number,
  durationTicks: number,
  analysis: TestChordDraft,
) {
  return createChordRegion(
    project,
    startTick,
    durationTicks,
    testChordDraft(analysis),
    id,
  );
}

function addPair(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  pitches: [number, number],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (midiNote, index) =>
      note(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
  );
}

function addLine(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  pitches: number[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (midiNote, index) =>
      note(`${voiceId}-${index}`, index * PPQ, PPQ, midiNote),
  );
}

function addChord(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  index: number,
  analysis: TestChordDraft,
) {
  project.chordTrack.regions.push(
    chordRegion(project, id, index * PPQ, PPQ, analysis),
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
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
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
        (item) =>
          item.ruleId === "voice-leading.parallel-fifths" && item.tick === PPQ,
      ),
    ).toBe(true);
  });

  it("同和弦转换仍检查平行八度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
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

    expect(ruleIds(project)).toContain("voice-leading.parallel-octaves");
  });

  it("同和弦转换仍检查声部交叉", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-1", 0, tonic);
    addChord(project, "tonic-2", 1, tonic);
    addPair(project, "soprano", [72, 67]);
    addPair(project, "alto", [67, 72]);

    expect(ruleIds(project)).toContain("voice.crossing");
  });

  it("同和弦转换放宽八度内大跳与声部超越", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "tonic-1", 0, tonic);
    addChord(project, "tonic-2", 1, tonic);
    addPair(project, "soprano", [67, 76]);
    addPair(project, "alto", [64, 72]);

    const ids = ruleIds(project);
    expect(ids).not.toContain("melody.large-leap");
    expect(ids).not.toContain("voice-leading.overlap");
  });

  it("同和弦转换放宽外声部隐伏完全协和音程", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
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

    expect(ruleIds(project)).not.toContain("voice-leading.hidden-fifth");
  });

  it("同一七和弦内的三全音分解不触发旋律警告", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const dominantSeventh: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "dominant7",
      inversion: 0,
    };
    addChord(project, "dominant-7-1", 0, dominantSeventh);
    addChord(project, "dominant-7-2", 1, dominantSeventh);
    addPair(project, "soprano", [71, 65]);

    expect(ruleIds(project)).not.toContain("melody.tritone");
  });

  it("使用规则配置改写诊断严重度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);
    addPair(project, "bass", [48, 50]);
    const severities = defaultHarmonyRuleSeverities();
    severities["voice-leading.parallel-fifths"] = "suggestion";

    const diagnostic = checkHarmony(project, severities).diagnostics.find(
      (item) => item.ruleId === "voice-leading.parallel-fifths",
    );
    expect(diagnostic?.severity).toBe("suggestion");
  });

  it("严重度为无时关闭该规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);
    addPair(project, "bass", [48, 50]);
    const severities = defaultHarmonyRuleSeverities();
    severities["voice-leading.parallel-fifths"] = "off";

    expect(
      checkHarmony(project, severities).diagnostics.map((item) => item.ruleId),
    ).not.toContain("voice-leading.parallel-fifths");
  });

  it("辅助轨音符不作为第五声部参与和声规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.auxiliaryTracks.push({
      id: "aux-reference",
      kind: "auxiliary",
      role: "reference",
      name: "参考材料",
      shortName: "Ref",
      notes: [note("aux-high", 0, PPQ * 2, 127)],
      participatesInHarmony: false,
      monophonic: false,
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 0.8,
      pan: 0,
      program: 0,
    });

    const diagnostics = checkHarmony(project).diagnostics;
    expect(diagnostics.some((item) => item.noteIds.includes("aux-high"))).toBe(
      false,
    );
  });

  it("和弦轨为空时明确跳过依赖和弦标注的规则", () => {
    const result = checkHarmony(createEmptyProject());
    expect(result.skippedRuleIds).toEqual(
      expect.arrayContaining([
        "chord.unclassified-nonchord-tone",
        "chord.incomplete-members",
        "chord.inversion-bass",
        "chord.doubled-leading-tone",
        "resolution.chord-seventh",
      ]),
    );
  });

  it("已关闭的和弦规则不计入跳过统计", () => {
    const severities = defaultHarmonyRuleSeverities();
    severities["chord.unclassified-nonchord-tone"] = "off";

    expect(
      checkHarmony(createEmptyProject(), severities).skippedRuleIds,
    ).not.toContain("chord.unclassified-nonchord-tone");
  });

  it("识别同一声部内时间重叠的音符", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.satbTracks[0].notes = [
      note("s-0", 0, PPQ, 67),
      note("s-1", PPQ / 2, PPQ, 69),
    ];

    expect(ruleIds(project)).toContain("voice.polyphonic-overlap");
  });

  it("相邻但不重叠的同声部音符不触发重叠规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [67, 69]);

    expect(ruleIds(project)).not.toContain("voice.polyphonic-overlap");
  });

  it("大调导音上行到主音时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [71, 72]);

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("连续导音未上行到主音时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addPair(project, "soprano", [71, 69]);

    const result = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "resolution.leading-tone",
    );
    expect(result?.subjects).toEqual({
      origin: {
        voiceIds: ["soprano"],
        noteIds: ["soprano-0"],
        chordIds: [],
        spanIds: [],
      },
      failure: {
        voiceIds: ["soprano"],
        noteIds: ["soprano-1"],
        chordIds: [],
        spanIds: [],
      },
    });
    expect(result?.trace?.at(-1)).toEqual({
      tick: PPQ,
      outcome: "violate",
      reason: "leading-tone-moved-elsewhere",
    });
    expect(result?.debug).toMatchObject({
      schemaVersion: "satb-diagnostic-debug/v1",
      runtime: {
        ruleId: "resolution.leading-tone",
        source: "builtin",
        severity: "warning",
      },
      diagnostic: {
        id: result?.id,
        severity: "warning",
      },
      obligation: {
        steps: expect.arrayContaining([
          expect.objectContaining({
            outcome: "violate",
            reason: "leading-tone-moved-elsewhere",
          }),
        ]),
      },
    });
    expect(formatDiagnosticDebugReport(result!)).toContain(
      "SATB Master Diagnostic Debug Report",
    );
  });

  it("小调自然七级不被误判为升高导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents[0] = {
      ...project.keyEvents[0],
      tonic: { step: "C", alter: 0 },
      mode: "minor",
    };
    addPair(project, "soprano", [70, 68]);

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("换调边界不沿用旧调导音解决要求", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents.push({
      id: "key-d",
      tick: PPQ,
      tonic: { step: "D", alter: 0 },
      mode: "major",
    });
    addPair(project, "soprano", [71, 69]);

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("同和弦连续转换后再检查导音解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, { ...dominant, inversion: 1 });
    addChord(project, "tonic", 2, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 59, 60]);

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("任意长度的同和弦转换链只在离开 span 后判定导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    const dominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-root", 0, dominant);
    addChord(project, "dominant-first", 1, { ...dominant, inversion: 1 });
    addChord(project, "dominant-second", 2, { ...dominant, inversion: 2 });
    addChord(project, "tonic", 3, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 55, 59, 60]);

    const analysis = buildHarmonyAnalysis(project);
    const spans = analysis.harmonySpans;
    expect(spans).toHaveLength(2);
    expect(spans[0].regionIds).toEqual([
      "dominant-root",
      "dominant-first",
      "dominant-second",
    ]);
    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("同和弦转换中导音可以在声部之间接力后再解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    const dominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, { ...dominant, inversion: 1 });
    addChord(project, "dominant-3", 2, { ...dominant, inversion: 2 });
    addChord(project, "tonic", 3, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });

    // B4（女低音） -> B4（女高音） -> B3（男低音） -> C4。
    addLine(project, "soprano", [79, 71, 79, 72]);
    addLine(project, "alto", [71, 67, 67, 67]);
    addLine(project, "tenor", [62, 62, 62, 64]);
    addLine(project, "bass", [55, 55, 59, 60]);

    expect(
      checkHarmony(project).diagnostics.filter(
        (item) => item.ruleId === "resolution.leading-tone",
      ),
    ).toEqual([]);
  });

  it("置信度变化会切断 HarmonySpan，避免确定语义覆盖歧义语义", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const tonic: TestChordDraft = {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      confidence: "certain",
    };
    addChord(project, "certain-tonic", 0, tonic);
    addChord(project, "ambiguous-tonic", 1, {
      ...tonic,
      confidence: "ambiguous",
    });

    const analysis = buildHarmonyAnalysis(project);
    const spans = analysis.harmonySpans;
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.status)).toEqual(["complete", "ambiguous"]);
  });

  it("导音状态不会跨过休止错误关联到更晚的音符", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    addChord(project, "dominant", 0, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addChord(project, "tonic", 2, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    project.satbTracks
      .find((track) => track.voice === "tenor")!
      .notes.push(
        note("leading-tone", 0, PPQ, 59),
        note("later-note", PPQ * 2, PPQ, 57),
      );

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("工程结束时没有后继音不会凭空生成解决错误", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    addChord(project, "dominant", 0, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59]);

    expect(ruleIds(project)).not.toContain("resolution.leading-tone");
  });

  it("离开同和弦后导音仍未解决时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, dominant);
    addChord(project, "tonic", 2, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "tenor", [59, 59, 57]);

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "resolution.leading-tone",
    );
    expect(diagnostic?.tick).toBe(PPQ * 2);
  });

  it("V 到 V7 会切断和弦 span，但重复导音义务延续到最终解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    project.keyEvents[0] = {
      ...project.keyEvents[0],
      tonic: { step: "E", alter: -1 },
      mode: "major",
    };
    const dominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    };
    addChord(project, "dominant-1", 0, dominant);
    addChord(project, "dominant-2", 1, dominant);
    addChord(project, "dominant-seventh", 2, {
      degree: 5,
      degreeAlteration: 0,
      quality: "dominant7",
      inversion: 0,
    });
    addChord(project, "tonic", 3, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "alto", [62, 62, 62, 63]);
    project.satbTracks.find((track) => track.id === "alto")!.notes[3].pitch = {
      step: "E",
      alter: -1,
      octave: 4,
    };

    const analysis = buildHarmonyAnalysis(project);
    expect(analysis.harmonySpans).toHaveLength(3);
    expect(analysis.harmonySpans[0].regionIds).toEqual([
      "dominant-1",
      "dominant-2",
    ]);
    expect(analysis.harmonySpans[1].regionIds).toEqual(["dominant-seventh"]);
    expect(
      checkHarmony(project).diagnostics.filter(
        (item) => item.ruleId === "resolution.leading-tone",
      ),
    ).toEqual([]);
  });

  it.each([1, 2, 3, 5])(
    "合法解决前插入 %i 次导音起奏不改变规则结果",
    (repeatCount) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * (repeatCount + 1);
      project.keyEvents[0] = {
        ...project.keyEvents[0],
        tonic: { step: "E", alter: -1 },
        mode: "major",
      };
      for (let index = 0; index < repeatCount; index += 1) {
        addChord(project, `dominant-${index}`, index, {
          degree: 5,
          degreeAlteration: 0,
          quality: index === repeatCount - 1 ? "dominant7" : "major",
          inversion: 0,
        });
      }
      addChord(project, "tonic-after-repetitions", repeatCount, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      });
      addLine(project, "alto", [
        ...Array.from({ length: repeatCount }, () => 62),
        63,
      ]);
      project.satbTracks.find((track) => track.id === "alto")!.notes[
        repeatCount
      ].pitch = {
        step: "E",
        alter: -1,
        octave: 4,
      };

      expect(ruleIds(project)).not.toContain("resolution.leading-tone");
    },
  );

  it("七和弦七音级进下行解决时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "g7", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
      }),
      chordRegion(project, "tonic-after-g7", PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addPair(project, "alto", [65, 64]);

    expect(ruleIds(project)).not.toContain("resolution.chord-seventh");
  });

  it("七和弦七音未级进下行时给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "g7", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
      }),
      chordRegion(project, "tonic-after-g7", PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addPair(project, "alto", [65, 67]);

    expect(ruleIds(project)).toContain("resolution.chord-seventh");
  });

  it("七音即使级进下行，未落到目标和弦音仍给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "g7-to-tonic", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
      }),
      chordRegion(project, "tonic-target", PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    project.satbTracks.find((track) => track.id === "alto")!.notes = [
      {
        ...note("seventh", 0, PPQ, 65),
        pitch: { step: "F", alter: 0, octave: 4 },
      },
      {
        ...note("false-resolution", PPQ, PPQ, 63),
        pitch: { step: "E", alter: -1, octave: 4 },
      },
    ];

    expect(ruleIds(project)).toContain("resolution.chord-seventh");
  });

  it("同声部重叠检查不会漏掉被较短音符隔开的长音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.satbTracks.find((track) => track.id === "soprano")!.notes = [
      note("long", 0, PPQ * 3, 72),
      note("middle", PPQ, PPQ / 2, 74),
      note("late", PPQ * 2, PPQ / 2, 76),
    ];

    const overlaps = checkHarmony(project).diagnostics.filter(
      (item) => item.ruleId === "voice.polyphonic-overlap",
    );
    expect(
      overlaps.some(
        (item) =>
          item.noteIds.includes("long") && item.noteIds.includes("late"),
      ),
    ).toBe(true);
  });

  it("同一七和弦转换结束后再检查七音解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const dominantSeventh: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
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
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
    });
    addLine(project, "alto", [65, 65, 64]);

    expect(ruleIds(project)).not.toContain("resolution.chord-seventh");
  });

  it("检查和弦区域后半段的和弦外音并关联区域", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "c-major", 0, PPQ * 2, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    project.satbTracks[0].notes = [
      note("inside", 0, PPQ, 72),
      note("outside", PPQ, PPQ, 74),
    ];

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord.unclassified-nonchord-tone",
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
    project.chordTrack.regions.push(
      chordRegion(project, "c-major", 0, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    project.satbTracks[0].notes = [
      { ...note("passing", 0, PPQ, 74), nonChordToneRole: "passing" },
    ];

    expect(ruleIds(project)).not.toContain("chord.unclassified-nonchord-tone");
  });

  it("和弦构成音不完整只关联和弦区域", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions.push(
      chordRegion(project, "c-major", 0, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    project.satbTracks[0].notes = [note("soprano-c", 0, PPQ, 72)];
    project.satbTracks[1].notes = [note("alto-g", 0, PPQ, 67)];
    project.satbTracks[2].notes = [note("tenor-c", 0, PPQ, 60)];
    project.satbTracks[3].notes = [note("bass-c", 0, PPQ, 48)];

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord.incomplete-members",
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
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ * 3, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addLine(project, "soprano", [74, 79, 74]);
    addLine(project, "alto", [71, 71, 71]);
    addLine(project, "tenor", [67, 59, 67]);
    addLine(project, "bass", [43, 43, 43]);

    const ids = ruleIds(project);
    expect(ids).not.toContain("chord.incomplete-members");
    expect(ids).not.toContain("chord.doubled-leading-tone");
  });

  it("同和弦转换结束时仍缺音或重复导音继续给出提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ * 3, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addLine(project, "soprano", [74, 79, 79]);
    addLine(project, "alto", [71, 71, 71]);
    addLine(project, "tenor", [67, 59, 59]);
    addLine(project, "bass", [43, 43, 43]);

    const ids = ruleIds(project);
    expect(ids).toContain("chord.incomplete-members");
    expect(ids).toContain("chord.doubled-leading-tone");
  });

  it("按斯波索宾基础功能序进提示属到下属的逆功能进行", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
      }),
      chordRegion(project, "subdominant", PPQ, PPQ, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
      }),
    );

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "function.retrogression",
    );
    expect(diagnostic?.chordIds).toEqual(["dominant", "subdominant"]);
    expect(diagnostic?.severity).toBe("warning");
  });

  it("跨乐句的半终止后进入下属不提示逆功能进行", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.structure.phraseBoundaries = [
      {
        id: "phrase-boundary",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
      }),
      chordRegion(project, "subdominant", PPQ, PPQ, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
      }),
    );
    addLine(project, "soprano", [74, 72]);
    addLine(project, "alto", [71, 67]);
    addLine(project, "tenor", [67, 64]);
    addLine(project, "bass", [43, 48]);

    expect(ruleIds(project)).not.toContain("function.retrogression");
  });

  it("全终止末端主和弦可省略五音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
      chordRegion(project, "tonic", PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addLine(project, "soprano", [74, 76]);
    addLine(project, "alto", [71, 72]);
    addLine(project, "tenor", [67, 60]);
    addLine(project, "bass", [43, 48]);

    expect(ruleIds(project)).not.toContain("chord.incomplete-members");
  });

  it("属七和弦可省略五音并使用根根三七配置", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions.push(
      chordRegion(project, "dominant-seventh", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
      }),
      chordRegion(project, "tonic", PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );
    addLine(project, "soprano", [77, 76]);
    addLine(project, "alto", [71, 72]);
    addLine(project, "tenor", [67, 60]);
    addLine(project, "bass", [55, 48]);

    expect(ruleIds(project)).not.toContain("chord.incomplete-members");
  });

  it("副属和弦重复转换后再检查目标解决", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const secondaryDominant: TestChordDraft = {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      appliedTarget: 2,
      designation: {
        notationSystem: "spasobin",
        kind: "applied-dominant",
        primaryFunction: "dominant",
      },
    };
    addChord(project, "secondary-dominant-1", 0, secondaryDominant);
    addChord(project, "secondary-dominant-2", 1, {
      ...secondaryDominant,
      inversion: 1,
    });
    addChord(project, "supertonic", 2, {
      degree: 2,
      degreeAlteration: 0,
      quality: "minor",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "side-degree",
        primaryFunction: "subdominant",
      },
    });

    expect(ruleIds(project)).not.toContain("function.applied-dominant-target");
  });

  it("指向属功能的副属目标允许经 K46 延迟完成", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    addChord(project, "applied-dominant", 0, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      appliedTarget: 5,
      designation: {
        notationSystem: "spasobin",
        kind: "applied-dominant",
        primaryFunction: "dominant",
      },
    });
    addChord(project, "cadential64", 1, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 2,
      designation: {
        notationSystem: "spasobin",
        kind: "cadential64",
        primaryFunction: "dominant",
      },
      cadenceRole: "cadential64",
    });
    addChord(project, "dominant", 2, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "primary",
        primaryFunction: "dominant",
      },
    });

    expect(ruleIds(project)).not.toContain("function.applied-dominant-target");
    expect(buildHarmonyAnalysis(project, 1).targetChains[0]).toMatchObject({
      sourceSpanId: "harmony-span-1",
      pathSpanIds: ["harmony-span-2", "harmony-span-3"],
      status: "matched",
    });
  });

  it("副属目标不能只凭相同级数通过主次功能核对", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addChord(project, "secondary-dominant", 0, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      appliedTarget: 2,
      designation: {
        notationSystem: "spasobin",
        kind: "applied-dominant",
        primaryFunction: "dominant",
      },
    });
    addChord(project, "wrong-function", 1, {
      degree: 2,
      degreeAlteration: 0,
      quality: "minor",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "side-degree",
        primaryFunction: "tonic",
      },
    });

    expect(ruleIds(project)).toContain("function.applied-dominant-target");
  });

  it("空白区间会中断功能进行判断", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions.push(
      chordRegion(project, "dominant", 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
      chordRegion(project, "subdominant", PPQ * 2, PPQ, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
      }),
    );

    expect(ruleIds(project)).not.toContain("function.retrogression");
  });
});
