import { describe, expect, it } from "vitest";
import { createChordRegion, formatChord } from "./chords";
import {
  addChordRegion,
  splitChordRegion,
  transformChordRegions,
  updateChordRegion,
} from "./editing";
import {
  applyFunctionalDefinition,
  applyFunctionalForm,
  functionalDefinition,
} from "./functionalHarmonyCatalog";
import {
  createEmptyProject,
  PPQ,
  validateProject,
  type ChordDraft,
  type ChordRegion,
} from "./project";

function region(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  startTick: number,
  durationTicks = PPQ,
): ChordRegion {
  return createChordRegion(
    project,
    startTick,
    durationTicks,
    {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      source: "manual",
      confidence: "certain",
    },
    id,
  );
}

describe("和弦命名", () => {
  const cMajor = {
    id: "key-c",
    tick: 0,
    tonic: { step: "C" as const, alter: 0 as const },
    mode: "major" as const,
  };

  it("从结构计算罗马数字、绝对和弦与转位低音", () => {
    expect(
      formatChord(
        {
          degree: 2,
          degreeAlteration: 0,
          quality: "minor",
          inversion: 1,
          source: "manual",
          confidence: "certain",
        },
        cMajor,
      ),
    ).toMatchObject({
      roman: "ii6",
      absolute: "Dm/F",
      functional: "SII6",
      semanticSummary: "未指定功能",
    });
    expect(
      formatChord(
        {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 2,
          source: "manual",
          confidence: "certain",
        },
        cMajor,
      ),
    ).toMatchObject({
      roman: "V4/3",
      absolute: "G7/D",
    });
  });

  it("计算副属和弦和变化级数名称", () => {
    expect(
      formatChord(
        {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          appliedTarget: 5,
          source: "manual",
          confidence: "certain",
        },
        cMajor,
      ),
    ).toMatchObject({ roman: "V7/V", absolute: "D7" });
    expect(
      formatChord(
        {
          degree: 2,
          degreeAlteration: -1,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        cMajor,
      ),
    ).toMatchObject({
      roman: "♭II",
      absolute: "D♭",
    });
  });
  it.each([
    ["转位降五副属", { inversion: 1, alterations: [{ degree: 5, alter: -1 }] }, "V6/5(♭5)/V", "D7(♭5)/F♯"],
    ["含多个变音的九和弦", {
      inversion: 0, extensions: [9], alterations: [{ degree: 5, alter: -1 }, { degree: 9, alter: 1 }],
    }, "V9(♭5,♯9)/V", "D9(♭5,♯9)"],
  ] as const)("%s 的罗马名称保留变音和副属目标", (_name, structure, roman, absolute) => {
    expect(formatChord({
      degree: 5,
      degreeAlteration: 0,
      quality: "dominant7",
      inversion: structure.inversion,
      appliedTarget: 5,
      extensions: "extensions" in structure ? [...structure.extensions] : [],
      alterations: [...structure.alterations],
      source: "manual",
      confidence: "certain",
    }, cMajor)).toMatchObject({ roman, absolute });
  });
});

describe("和弦范围命令", () => {
  it("拒绝重叠和跨调性区域", () => {
    const project = createEmptyProject();
    project.keyEvents.push({
      id: "key-g",
      tick: PPQ * 2,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });
    const first = addChordRegion(project, region(project, "first", 0));
    expect(first.error).toBeUndefined();
    expect(
      addChordRegion(first.project, region(first.project, "overlap", PPQ / 2))
        .error,
    ).toContain("重叠");
    expect(
      addChordRegion(
        first.project,
        region(first.project, "cross-key", PPQ, PPQ * 2),
      ).error,
    ).toContain("调性");
  });

  it("批量移动与切分各自形成一次纯命令结果", () => {
    let project = createEmptyProject();
    project = addChordRegion(project, region(project, "first", 0)).project;
    project = addChordRegion(
      project,
      region(project, "second", PPQ * 2),
    ).project;
    const moved = transformChordRegions(
      project,
      new Set(["first", "second"]),
      (item) => ({
        ...item,
        startTick: item.startTick + PPQ,
      }),
    );
    expect(moved.error).toBeUndefined();
    expect(
      moved.project.chordTrack.regions.map((item) => item.startTick),
    ).toEqual([PPQ, PPQ * 3]);

    const split = splitChordRegion(moved.project, "first", PPQ + PPQ / 2);
    expect(split.project.chordTrack.regions).toHaveLength(3);
    expect(
      split.project.chordTrack.regions
        .slice(0, 2)
        .map((item) => item.durationTicks),
    ).toEqual([PPQ / 2, PPQ / 2]);
  });

  it("三和弦不接受第三转位且锁定区域不可移动", () => {
    let project = addChordRegion(
      createEmptyProject(),
      region(createEmptyProject(), "first", 0),
    ).project;
    expect(
      updateChordRegion(project, "first", { draft: { inversion: 3 } }).error,
    ).toContain("无效");
    project = updateChordRegion(project, "first", { locked: true }).project;
    expect(
      transformChordRegions(project, new Set(["first"]), (item) => ({
        ...item,
        startTick: PPQ,
      })).error,
    ).toContain("锁定");
  });

  it("K46、N6、D9 与增六和弦的固定转位在命令层生效", () => {
    const base: ChordDraft = {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      extensions: [],
      alterations: [],
      inversion: 0,
      source: "manual",
      confidence: "certain",
    };
    const cases = [
      applyFunctionalDefinition(base, functionalDefinition("K46"), "major"),
      applyFunctionalDefinition(base, functionalDefinition("N6"), "major"),
      applyFunctionalDefinition(base, functionalDefinition("Ger+6"), "major"),
      applyFunctionalForm(
        applyFunctionalDefinition(base, functionalDefinition("D"), "major"),
        functionalDefinition("D"),
        "ninth",
        "major",
      ),
    ];
    for (const [index, draft] of cases.entries()) {
      let project = createEmptyProject();
      project = addChordRegion(
        project,
        createChordRegion(project, 0, PPQ, draft, `fixed-${index}`),
      ).project;
      const illegal = draft.inversion === 0 ? 1 : 0;
      expect(
        updateChordRegion(project, `fixed-${index}`, {
          draft: { inversion: illegal },
        }).error,
      ).toContain("无效");
    }
  });

  it("批量移动跨到新调性后重算和弦实体拼写", () => {
    let project = createEmptyProject();
    project.keyEvents.push({
      id: "key-g",
      tick: PPQ * 2,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });
    project = addChordRegion(project, region(project, "tonic", 0)).project;

    const moved = transformChordRegions(
      project,
      new Set(["tonic"]),
      (item) => ({ ...item, startTick: PPQ * 3 }),
    );

    expect(moved.error).toBeUndefined();
    expect(moved.project.chordTrack.regions[0].identity.root).toEqual({
      step: "G",
      alter: 0,
    });
    expect(validateProject(moved.project)).toBe(true);
  });
});
