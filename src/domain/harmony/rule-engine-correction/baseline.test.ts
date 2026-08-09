import { describe, expect, it } from "vitest";
import {
  HARMONY_RULE_DEFINITIONS,
  buildHarmonyAnalysis,
  checkHarmony,
} from "..";
import { PPQ } from "../../project";
import {
  correctionChord,
  correctionNote,
  correctionProject,
  setCorrectionVoice,
} from "./fixtures";

describe("规则引擎修正基线", () => {
  it("固定当前规则目录及实施数量", () => {
    const implemented = HARMONY_RULE_DEFINITIONS.filter(
      (definition) => definition.implemented,
    );
    const deferred = HARMONY_RULE_DEFINITIONS.filter(
      (definition) => !definition.implemented,
    );

    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(81);
    expect(implemented).toHaveLength(44);
    expect(deferred).toHaveLength(37);
    expect(new Set(HARMONY_RULE_DEFINITIONS.map(({ id }) => id)).size).toBe(81);
  });

  it("单个和弦区域内部的调号变化必须切断 HarmonySpan", () => {
    const project = correctionProject(PPQ * 2);
    project.chordTrack.regions = [
      correctionChord("tonic-region", 0, PPQ * 2),
    ];
    project.keyEvents.push({
      id: "key-change",
      tick: PPQ,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });

    const analysis = buildHarmonyAnalysis(project, 1);
    expect(analysis.harmonySpans).toHaveLength(2);
    expect(analysis.harmonySpans.map((span) => [span.fromTick, span.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
    ]);
  });

  it("旋律规则不能跨过休止关联两个起奏音", () => {
    const project = correctionProject(PPQ * 3);
    setCorrectionVoice(project, "soprano", [
      correctionNote("before-rest", 0, { step: "C", alter: 0, octave: 4 }),
      correctionNote(
        "after-rest",
        PPQ * 2,
        { step: "C", alter: 0, octave: 6 },
      ),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (diagnostic) =>
          diagnostic.ruleId === "melody.leap-over-octave" ||
          diagnostic.ruleId === "melody.large-leap",
      ),
    ).toBe(false);
  });
});
