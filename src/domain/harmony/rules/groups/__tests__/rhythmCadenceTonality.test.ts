import { describe, expect, it } from "vitest";
import type { ChordDraft } from "../../../../chordModel";
import { createChordRegion } from "../../../../chords";
import { createEmptyProject, PPQ, type ProjectDocument } from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { checkHarmony } from "../../../registry";

describe("变格终止的低音公式", () => {
  function plagalCadence(kind: "full" | "supplementary", sourceBass = "F3") {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | F4/1 | E4/1 |
 A: | C4/1 | C4/1 |
 T: | A3/1 | G3/1 |
 B: | ${sourceBass}/1 | C3/1 |
 H: | S/1 | T/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=${kind} form=plagal
}`).project;
  }

  describe("变格终止低音公式", () => {
    it.each(["full", "supplementary"] as const)("%s/plagal 使用 4→1 低音", kind => {
      const diagnostics = checkHarmony(plagalCadence(kind)).diagnostics;
      expect(diagnostics.filter(item => item.ruleId === "cadence.bass-formula")).toHaveLength(0);
    });

    it.each(["full", "supplementary"] as const)("%s/plagal 仍拒绝错误的 6→1 低音", kind => {
      const diagnostics = checkHarmony(plagalCadence(kind, "A2")).diagnostics;
      expect(diagnostics.filter(item => item.ruleId === "cadence.bass-formula")).toHaveLength(1);
    });

    it.each([
      { sourceBass: "C3", role: "pedal64", reports: false },
      { sourceBass: "C2", role: "pedal64", reports: true },
      { sourceBass: "C3", role: "passing64", reports: true },
    ])("补充变格使用 $role 时检查主音低音 $sourceBass", ({ sourceBass, role, reports }) => {
      const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | F4/1 | E4/1 |
 A: | C4/1 | C4/1 |
 T: | A3/1 | G3/1 |
 B: | ${sourceBass}/1 | C3/1 |
}
annotations {
 chord s range=[1:1,2:1) symbol=IV64 role=${role}
 chord t range=[2:1,3:1) symbol=I
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=supplementary form=plagal
}`).project;
      expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
    });

    it.each([
      { qualifier: "", bass: "F3", reports: false },
      { qualifier: "form=authentic", bass: "F3", reports: true },
      { qualifier: "", bass: "A3", reports: true },
    ])("半终止 $qualifier 核对下属低音 $bass", ({ qualifier, bass, reports }) => {
      const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | E4/1 | F4/1 |
 A: | C4/1 | C4/1 |
 T: | G3/1 | A3/1 |
 B: | C3/1 | ${bass}/1 |
 H: | I/1 | IV/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=half ${qualifier}
}`).project;
      expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
    });

    it.each([
      { completion: "imperfect", bass: "B2", reports: false },
      { completion: "imperfect", bass: "D3", reports: true },
      { completion: "perfect", bass: "B2", reports: true },
    ])("$completion 正格终止区分属六的正确低音与根音要求", ({ completion, bass, reports }) => {
      const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | D5/1 | C5/1 |
 A: | G4/1 | G4/1 |
 T: | G3/1 | E3/1 |
 B: | ${bass}/1 | C3/1 |
 H: | V6/1 | I/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=full form=authentic completion=${completion}
}`).project;
      expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
    });
  });
});

describe("和声切分、终止四六拍位与调性", () => {
  function draft(
    degree: ChordDraft["degree"],
    quality: ChordDraft["quality"],
    primaryFunction: "tonic" | "subdominant" | "dominant",
    options: Partial<ChordDraft> = {},
  ): ChordDraft {
    return {
      degree,
      degreeAlteration: 0,
      quality,
      extensions: [],
      alterations: [],
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind:
          degree === 1 || degree === 4 || degree === 5
            ? "primary"
            : "side-degree",
        primaryFunction,
      },
      source: "manual",
      confidence: "certain",
      ...options,
    };
  }

  function chord(
    project: ProjectDocument,
    id: string,
    startTick: number,
    durationTicks: number,
    value: ChordDraft,
  ) {
    return createChordRegion(project, startTick, durationTicks, value, id);
  }

  function diagnostic(project: ProjectDocument, messageKey: string) {
    return checkHarmony(project).diagnostics.find(
      (item) => item.messageKey === messageKey,
    );
  }

  describe("节拍、终止与调性规则", () => {
    it("和声在弱位进入并跨越下拍后，即使在第三拍离开也判为和声切分", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 8;
      const dominant = draft(5, "dominant7", "dominant");
      const tonic = draft(1, "major", "tonic");
      project.chordTrack.regions = [
        chord(project, "previous-dominant", 0, PPQ * 3, dominant),
        chord(project, "tonic-root-entry", PPQ * 3, PPQ / 2, tonic),
        chord(project, "tonic-first-inversion", PPQ * 3.5, PPQ / 2, {
          ...tonic,
          inversion: 1,
        }),
        chord(project, "tonic-root-continuation", PPQ * 4, PPQ * 2, tonic),
        chord(project, "following-dominant", PPQ * 6, PPQ * 2, dominant),
      ];

      const analysis = buildHarmonyAnalysis(project);
      const tonicSpan = analysis.harmonySpans.find(
        (span) => span.fromTick === PPQ * 3,
      );
      expect(tonicSpan).toMatchObject({
        fromTick: PPQ * 3,
        toTick: PPQ * 6,
      });
      expect(tonicSpan?.regionIds).toEqual([
        "tonic-root-entry",
        "tonic-first-inversion",
        "tonic-root-continuation",
      ]);

      const result = diagnostic(project, "rhythm.harmonic-syncopation");
      expect(result).toMatchObject({
        tick: PPQ * 3,
        endTick: PPQ * 6,
        params: {
          entryStrength: 1,
          exitStrength: 2,
          crossedStrength: 3,
        },
      });
    });

    it("K46 位于强位且强于后继属和弦时通过", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 4;
      project.chordTrack.regions = [
        chord(
          project,
          "cadential64",
          0,
          PPQ,
          draft(1, "major", "dominant", {
            inversion: 2,
            designation: {
              notationSystem: "spasobin",
              kind: "cadential64",
              primaryFunction: "dominant",
            },
            cadenceRole: "cadential64",
          }),
        ),
        chord(
          project,
          "dominant",
          PPQ,
          PPQ * 3,
          draft(5, "major", "dominant"),
        ),
      ];

      expect(
        diagnostic(project, "cadence.cadential64-metric-position"),
      ).toBeUndefined();
    });

    it("K46 位于弱位且后继属和弦更强时报告拍位不当", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 4;
      project.chordTrack.regions = [
        chord(project, "tonic", 0, PPQ, draft(1, "major", "tonic")),
        chord(
          project,
          "cadential64",
          PPQ,
          PPQ,
          draft(1, "major", "dominant", {
            inversion: 2,
            designation: {
              notationSystem: "spasobin",
              kind: "cadential64",
              primaryFunction: "dominant",
            },
            cadenceRole: "cadential64",
          }),
        ),
        chord(
          project,
          "dominant",
          PPQ * 2,
          PPQ * 2,
          draft(5, "major", "dominant"),
        ),
      ];

      expect(
        diagnostic(project, "cadence.cadential64-metric-position"),
      ).toMatchObject({
        tick: PPQ,
        params: { sourceStrength: 1, targetStrength: 2 },
      });
    });
  });
});
