import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../../../project";
import type { ProjectDocument } from "../../../../project/types";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../../inference";
import { checkHarmony } from "../../../registry";
import {
  diagnosticFor,
  functionalChord,
  manualCertain,
  note,
  pitch,
  setLine,
  triadRegion,
} from "../../../testing/fixtures/ruleProjects";

describe("副属导音引入时的先后对斜", () => {
  const rule = "voice-leading.cross-relation-successive";

  function parts(soprano: string, alto: string, tenor: string, bass: string, symbols = "") {
    return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${symbols && "H: | " + symbols + " |"}
}`).project;
  }

  function applied(transfer: boolean, blind: boolean) {
    const project = parts(
      (transfer ? "E5" : "G4") + "/4 G#4/4 A4/4",
      (transfer ? "G4" : "E4") + "/4 E4/4 E4/4",
      "C4/4 D4/4 C4/4", "C3/4 B2/4 A2/4",
      blind ? "" : "I/4 V43/VI/4 vi/4",
    );
    return blind ? applyHarmonyInference(project, { chordInference: inferChords(project) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project : project;
  }

  function relations(p: ReturnType<typeof parts>) {
    return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === p.ppq);
  }

  describe("副属导音的半音引入", () => {
    it.each([false, true])("保持和弦与解决不变，仅在 G 转交另一声部时提示（盲推 %s）", blind => {
      const good = applied(false, blind);
      const bad = applied(true, blind);
      expect(relations(good)).toEqual([]);
      expect(relations(bad)).toContainEqual(expect.objectContaining({
        severity: "suggestion", voiceIds: ["alto", "soprano"], endTick: 2 * bad.ppq,
        noteIds: expect.arrayContaining(["note-A-0", "note-S-" + bad.ppq]),
      }));
    });

    it("重复音的一份原声部半音上行，另一份下行，保持合法", () => {
      const p = parts("F4/4 Eb4/4 D4/4", "C4/4 C4/4 B3/4",
        "A3/4 A3/4 G3/4", "F3/4 F#3/4 G2/4", "IV/4 viio7/V/4 V/4");
      expect(relations(p)).toEqual([]);
    });

    it("前一个自然音与目标相隔休止时不恢复该提示", () => {
      const p = applied(true, false);
      p.satbTracks.find(t => t.id === "alto")!.notes[0].durationTicks = p.ppq / 2;
      expect(relations(p)).toEqual([]);
    });

    it("写作 Ab 的音与 G 不构成同字母半音移交", () => {
      const p = applied(true, false);
      p.satbTracks.find(t => t.id === "soprano")!.notes[1].pitch = { step: "A", alter: -1, octave: 4 };
      expect(relations(p)).toEqual([]);
    });

    it("后续转入局部小调时仍定位到先前的移交", () => {
      const p = applied(true, false);
      const landing = p.chordTrack.regions[2].semantics!.interpretations[0];
      landing.localKey = { tonic: { step: "A", alter: 0 }, mode: "minor" };
      landing.degree = 1;
      expect(relations(p)).toContainEqual(expect.objectContaining({
        voiceIds: ["alto", "soprano"],
        causeRefs: [expect.stringContaining("connection:")],
      }));
    });

    it("当前连接本身更换局部调时保留豁免", () => {
      const p = applied(true, false);
      const previous = p.chordTrack.regions[0].semantics!.interpretations[0];
      previous.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
      previous.degree = 5;
      expect(relations(p)).toEqual([]);
    });

    it("手动句界两侧的副属引入保持原有豁免", () => {
      const p = applied(true, false);
      p.structure.phraseBoundaries.push({ id: "split", tick: p.ppq, source: "manual", confidence: "certain" });
      expect(relations(p)).toEqual([]);
    });
  });
});

describe("同时对斜和先后对斜", () => {
  describe("变化和弦中的对斜", () => {
    it("明确变化和弦构成音的先后半音化不误报为对斜", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        triadRegion("plain-tonic", 0, "C", "major"),
        functionalChord(project, "double-dominant", 1, {
          degree: 2,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "double-dominant",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
      ];
      setLine(project, "soprano", [pitch("F", 0, 4)]);
      project.satbTracks.find((track) => track.id === "alto")!.notes = [
        note("altered-third", PPQ, pitch("F", 1, 4)),
      ];

      expect(
        diagnosticFor(project, "voice-leading.cross-relation-successive"),
      ).toBeUndefined();
    });
  });
});

describe("持续异变音与低音辅助音的同时对斜", () => {
  const eighth = PPQ / 2;
  const rule = "voice-leading.cross-relation-simultaneous";

  function neighbor({
    soprano = "A4/2.",
    alto = "D#4/2.",
    bass = "B2/8 A#2/8 B2/2",
    harmony = "",
  }: { soprano?: string; alto?: string; bass?: string; harmony?: string } = {}) {
    return compileScoreText(`satb 1
key E major
meter 6/8
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | F#3/2. |
 B: | ${bass} |
}
${harmony}`).project;
  }

  function crossings(project: ProjectDocument, tick = eighth) {
    return checkHarmony(project).diagnostics
      .filter(diagnostic => diagnostic.ruleId === rule && diagnostic.tick === tick)
      .map(({ voiceIds, endTick, severity }) => ({ voiceIds, endTick, severity }));
  }

  const outer = { voiceIds: ["bass", "soprano"], endTick: PPQ, severity: "warning" };

  describe("低音下方半音辅助遇到跨八度的持续异变音", () => {
    it("三上声部持续不重奏，弱位下行半音返回同一个完整属七，标签空白也静默", () => {
      expect(crossings(neighbor())).toEqual([]);
    });

    it("完整属七标签覆盖辅助段时仍按实奏上下文静默", () => {
      const project = neighbor({ harmony: 'annotations {\n chord base at=1:1 duration=1/2. symbol=D7\n}' });
      expect(crossings(project)).toEqual([]);
    });

    it("上声部重奏相同音高时，两个独立起奏的异变仍警告", () => {
      expect(crossings(neighbor({ soprano: "A4/8 A4/8 A4/2" }))).toEqual([outer]);
    });

    it("低音去往下一音的半音经过仍警告", () => {
      expect(crossings(neighbor({ bass: "B2/8 A#2/8 A2/2" }))).toEqual([outer]);
    });

    it("低音同字母原位改变升降号即使回到锚点也仍警告", () => {
      const project = neighbor({ soprano: "B4/2.", bass: "B2/8 Bb2/8 B2/2" });
      expect(crossings(project)).toEqual([outer]);
    });

    it("有独立起奏的其他和弦成员，低音回返不掩盖实际换和弦", () => {
      const project = neighbor({ alto: "D#4/8 C#4/8 D#4/2" });
      // F# major/A# sounds in the middle, with A4 held above it.
      expect(crossings(project)).toEqual([outer]);
    });

    it("外形相同但明确标出另一个实奏三和弦时保留异变诊断", () => {
      const project = neighbor({
        harmony: 'annotations {\n chord alternate at=1:2 duration=1/8 symbol=iii64 localKey="B major"\n}',
      });
      const chord = project.chordTrack.regions[0];
      expect(chord).toMatchObject({
        startTick: eighth, durationTicks: eighth,
        identity: { root: { step: "D", alter: 1 }, bass: { step: "A", alter: 1 }, structure: { quality: "minor" } },
      });
      expect(crossings(project)).toEqual([outer]);
    });

    it("辅助外形跨手动句界时继续检查", () => {
      const project = neighbor();
      project.structure.phraseBoundaries.push({ id: "boundary", tick: PPQ, source: "manual", confidence: "certain" });
      expect(crossings(project)).toEqual([outer]);
    });

    it("强拍开始的同形不借用弱位辅助音条件", () => {
      const project = compileScoreText(`satb 1
key E major
meter 3/4
bars 1..2 {
 S: | A4/2.~ | A4/2. |
 A: | D#4/2.~ | D#4/2. |
 T: | F#3/2.~ | F#3/2. |
 B: | B2/2. | A#2/4 B2/2 |
}
`).project;
      expect(crossings(project, 3 * PPQ)).toEqual([{ ...outer, endTick: 4 * PPQ }]);
    });

    it("相同音区的两个不同声部使用自然音和升音时仍警告", () => {
      const project = neighbor({ soprano: "C5/8 E#4/8 C5/2", alto: "E4/8 E4/8 E4/2", bass: "B2/2." });
      expect(crossings(project)).toEqual([{ ...outer, voiceIds: ["alto", "soprano"] }]);
    });
  });
});
