import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../../chords";
import { checkHarmony } from "../../registry";
import {
  createEmptyProject,
  PPQ,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../project";
import type { SpelledPitch } from "../../../pitch";

function note(id: string, startTick: number, pitch: SpelledPitch): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch,
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function setLine(
  project: ProjectDocument,
  voiceId: VoiceId,
  pitches: readonly SpelledPitch[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (pitch, index) => note(`${voiceId}-${index}`, index * PPQ, pitch),
  );
}

function pitch(step: SpelledPitch["step"], alter: -1 | 0 | 1, octave: number) {
  return { step, alter, octave } satisfies SpelledPitch;
}

function diagnosticFor(project: ProjectDocument, ruleId: string) {
  return checkHarmony(project).diagnostics.find(
    (diagnostic) => diagnostic.ruleId === ruleId,
  );
}

function functionalChord(
  project: ProjectDocument,
  id: string,
  index: number,
  draft: Parameters<typeof createChordRegion>[3],
) {
  return createChordRegion(project, index * PPQ, PPQ, draft, id);
}

const manualCertain = {
  source: "manual",
  confidence: "certain",
} as const;

describe("H 组和弦连接规则体系（斯波索宾金样本与 QueryAPI 升级）", () => {
  it("Case H1-A: 标准完全属七到不完全主和弦（省略五音，三根一三）不误报共同音与导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "dominant-seventh", 0, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "tonic-incomplete", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
    ];

    // D7 -> I 完全到不完全（省略五音，三个根音，一个三音）
    // S: F4 -> E4 (七音下行二度)
    // A: D4 -> C4 (五音下行二度)
    // T: B3 -> C4 (导音上行二度)
    // B: G2 -> C3 (根音跳进四度)
    setLine(project, "soprano", [pitch("F", 0, 4), pitch("E", 0, 4)]);
    setLine(project, "alto", [pitch("D", 0, 4), pitch("C", 0, 4)]);
    setLine(project, "tenor", [pitch("B", 0, 3), pitch("C", 0, 4)]);
    setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

    expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
  });

  it("Case H1-B: 经过三四和弦 I - D34 - I6（低音 1->2->3 上行级进）判定合规", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [
      functionalChord(project, "tonic-1", 0, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
      functionalChord(project, "dominant-34", 1, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 2, // D34
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "tonic-6", 2, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 1, // I6
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
    ];

    // I - D34 - I6
    // B: C3 -> D3 -> E3 (低音平稳经过级进)
    // S: C5 -> B4 -> C5
    // A: G4 -> F4 -> E4
    // T: E4 -> D4 -> C4
    setLine(project, "soprano", [pitch("C", 0, 5), pitch("B", 0, 4), pitch("C", 0, 5)]);
    setLine(project, "alto", [pitch("G", 0, 4), pitch("F", 0, 4), pitch("E", 0, 4)]);
    setLine(project, "tenor", [pitch("E", 0, 4), pitch("D", 0, 4), pitch("C", 0, 4)]);
    setLine(project, "bass", [pitch("C", 0, 3), pitch("D", 0, 3), pitch("E", 0, 3)]);

    expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
  });

  it("Case H1-C: 内声部导音自由解决（Tenor 导音下行小三度跳至主和弦五音）判定合规", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "dominant-seventh", 0, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "tonic-complete", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
    ];

    // D7 -> 完全主和弦（含五音 G）
    // S: F4 -> E4 (七音下行)
    // A: D4 -> C4 (五音下行)
    // T: B3 -> G3 (Tenor 内声部导音自由跳进到主和弦五音，实现完全主和弦！)
    // B: G2 -> C3 (低音根音跳进)
    setLine(project, "soprano", [pitch("F", 0, 4), pitch("E", 0, 4)]);
    setLine(project, "alto", [pitch("D", 0, 4), pitch("C", 0, 4)]);
    setLine(project, "tenor", [pitch("B", 0, 3), pitch("G", 0, 3)]);
    setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

    expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
  });

  it("Case H1-D: 同和弦换位与时值切分不误判为异功能解决（same-harmony 前置拦截）", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    // 连续两个切片均为 D7（换声部排列）
    project.chordTrack.regions = [
      functionalChord(project, "dominant-seventh-1", 0, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "dominant-seventh-2", 1, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];

    setLine(project, "soprano", [pitch("F", 0, 4), pitch("D", 0, 5)]);
    setLine(project, "alto", [pitch("D", 0, 4), pitch("B", 0, 4)]);
    setLine(project, "tenor", [pitch("B", 0, 3), pitch("F", 0, 4)]);
    setLine(project, "bass", [pitch("G", 0, 2), pitch("G", 0, 2)]);

    expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
  });

  it("Case H2-A: 四部属九和弦省略五音解决至主和弦，不误报共同音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "dominant-ninth", 0, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        extensions: [9],
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "tonic", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
    ];

    // D9 -> I
    // S: A4 -> G4 (九音下行至五音)
    // A: F4 -> E4 (七音下行至三音)
    // T: B3 -> C4 (导音上行至主音)
    // B: G2 -> C3 (根音跳进至主音)
    setLine(project, "soprano", [pitch("A", 0, 4), pitch("G", 0, 4)]);
    setLine(project, "alto", [pitch("F", 0, 4), pitch("E", 0, 4)]);
    setLine(project, "tenor", [pitch("B", 0, 3), pitch("C", 0, 4)]);
    setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

    expect(diagnosticFor(project, "connection.dominant-ninth")).toBeUndefined();
  });

  it("Case H3-A: 导七和弦解决至属七和弦（DVII7 -> D7），后继功能与声部收缩判定合规", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "leading-tone-seventh", 0, {
        degree: 7,
        degreeAlteration: 0,
        quality: "diminished7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "side-degree",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "dominant-seventh", 1, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];

    // DVII7 -> D7
    // B: B2 -> G2 (导音三音 B 保持在上方，低音进入属音)
    // S: A-1 4 -> G4 (七音下行)
    // A: F4 -> F4 (七音保持)
    // T: D4 -> D4
    setLine(project, "soprano", [pitch("A", -1, 4), pitch("G", 0, 4)]);
    setLine(project, "alto", [pitch("F", 0, 4), pitch("F", 0, 4)]);
    setLine(project, "tenor", [pitch("B", 0, 3), pitch("B", 0, 3)]);
    setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);

    expect(diagnosticFor(project, "connection.leading-tone-seventh")).toBeUndefined();
  });

  it("Case H4-A: SII7 解决至 K46 时七音保持同音挂留，判定合规", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "supertonic-seventh", 0, {
        degree: 2,
        degreeAlteration: 0,
        quality: "minor7",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "side-degree",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "cadential64", 1, {
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
        ...manualCertain,
      }),
    ];

    // SII7 (D-F-A-C) -> K46 (G-C-E-G)
    // S: A4 -> G4
    // A: C4 -> C4 (七音 C 作为六度音保持在同一声部！)
    // T: F4 -> E4
    // B: D3 -> G2
    setLine(project, "soprano", [pitch("A", 0, 4), pitch("G", 0, 4)]);
    setLine(project, "alto", [pitch("C", 0, 4), pitch("C", 0, 4)]);
    setLine(project, "tenor", [pitch("F", 0, 4), pitch("E", 0, 4)]);
    setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);

    expect(diagnosticFor(project, "connection.supertonic-seventh")).toBeUndefined();
  });

  it("Case H6-A: DD7 三音（升4级属调导音）规范上行半音至属音判定通过，跳走则准确报警", () => {
    const makeProject = (resolvedPitch: SpelledPitch) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "double-dominant-seventh", 0, {
          degree: 2,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "double-dominant",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "dominant", 1, {
          degree: 5,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
      ];

      // DD7 (D - F# - A - C) -> V (G - B - D - G)
      // S: C5 -> B4 (七音下行至导音)
      // A: F#4 -> resolvedPitch (三音升4级属调导音，应上行半音至 G4)
      // T: A4 -> G4
      // B: D3 -> G2
      setLine(project, "soprano", [pitch("C", 0, 5), pitch("B", 0, 4)]);
      setLine(project, "alto", [pitch("F", 1, 4), resolvedPitch]);
      setLine(project, "tenor", [pitch("A", 0, 4), pitch("G", 0, 4)]);
      setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);
      return project;
    };

    // 正确上行半音至 G4: 合规
    expect(
      diagnosticFor(makeProject(pitch("G", 0, 4)), "connection.double-dominant-seventh"),
    ).toBeUndefined();

    // 错误下行至 E4: 报警属调导音未上半音解决
    const errorDiag = diagnosticFor(
      makeProject(pitch("E", 0, 4)),
      "connection.double-dominant-seventh",
    );
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.message).toContain("属调导音（升 IV 级）未上半音解决至属音");
  });

  it("Case I1-A: 四五度原位三和弦采用古典旋律连接法（上三声部全体与低音反向平稳进行）判定合规", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "tonic", 0, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
      functionalChord(project, "subdominant", 1, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
    ];

    // 原位 I -> IV
    // B: C3 -> F3 (低音上行四度)
    // S: G4 -> F4 (上声部下行二度)
    // A: E4 -> C4 (中声部下行三度)
    // T: C4 -> A3 (次中音下行三度)
    // 上三声部全体与低音反向进行，无平行五八度，无保持共同音 C（标准旋律连接法）
    setLine(project, "soprano", [pitch("G", 0, 4), pitch("F", 0, 4)]);
    setLine(project, "alto", [pitch("E", 0, 4), pitch("C", 0, 4)]);
    setLine(project, "tenor", [pitch("C", 0, 4), pitch("A", 0, 3)]);
    setLine(project, "bass", [pitch("C", 0, 3), pitch("F", 0, 3)]);

    expect(
      diagnosticFor(project, "connection.common-tone-fourth-fifth"),
    ).toBeUndefined();
  });
});
