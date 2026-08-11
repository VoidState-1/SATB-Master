import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../../chords";
import type { ChordDraft } from "../../../chordModel";
import {
  createEmptyProject,
  PPQ,
  type ProjectDocument,
} from "../../../project";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";

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
