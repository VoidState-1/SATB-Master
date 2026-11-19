import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
}

function fullExample({
  soprano = "D5/8 C#5/8 D5/8",
  alto = "F4/4.",
  tenor = "B3/8 A#3/8 B3/8",
  bass = "G2/4.",
  harmony = "V7/8 r/8 V7/8",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 3/8
bars 1..2 {
  S: | ${soprano} | C5/4. |
  A: | ${alto} | E4/4. |
  T: | ${tenor} | G3/4. |
  B: | ${bass} | C3/4. |
  H: | ${harmony} | I/4. |
}`).project;
}

function fullCadence(project: ReturnType<typeof fullExample>) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.kind === "full" && c.toTick === project.lengthTicks);
}

function remainsAtSecondDominant(project: ReturnType<typeof fullExample>) {
  const cadence = fullCadence(project);
  expect(cadence).toMatchObject({ fromTick: 960, toTick: 2880, form: "authentic", completion: "perfect" });
  expect(cadence?.evidence.some(item => item.code === "dominant-neighbor-prolongation")).toBe(false);
}

describe("双重辅助音装饰的终止属功能", () => {
  it("G7 两端同形、属低音和七音持续，确定已经存在的正格终止左端", () => {
    const cadence = fullCadence(fullExample());
    expect(cadence).toMatchObject({ fromTick: 0, toTick: 2880, form: "authentic", completion: "perfect" });
    expect(cadence?.evidence).toContainEqual(expect.objectContaining({
      code: "dominant-neighbor-prolongation", refs: ["note-S-480", "note-T-480"],
    }));
  });

  it("属三和弦之内的双辅助音不截断持续属和弦和此前相接的 K46 半终止", () => {
    const { project } = compileScoreText(`satb 1
key D major
meter 3/4
bars 1..1 {
 S: | F#5/4 E5/8 D#5/8 E5/4 |
 A: | A4/2. |
 T: | D4/4 C#4/8 B#3/8 C#4/4 |
 B: | A3/2. |
 H: | K46/4 V/8 r/8 V/4 |
}`);
    const [cadence] = buildHarmonyAnalysis(project).cadenceCandidates;
    expect(cadence).toMatchObject({ kind: "half", form: "authentic", fromTick: 0, toTick: 2880 });
    expect(cadence.evidence).toContainEqual(expect.objectContaining({ code: "dominant-neighbor-prolongation" }));
  });

  it.each<[string, Example]>([
    ["一个声部未返回原八度", { tenor: "B3/8 A#3/8 B4/8" }],
    ["同音异名冒充下方书写辅助音", { tenor: "B3/8 Bb3/8 B3/8" }],
    ["有声部休止", { soprano: "D5/8 r/8 D5/8" }],
    ["低音在缺口起奏同高音", { bass: "G2/8 G2/4" }],
    ["持留的上声部也重奏", { alto: "F4/8 F4/4" }],
    ["装饰占据比原和弦音更长的时值", { soprano: "D5/16 C#5/16~ C#5/8 D5/8" }],
  ])("%s 时保留原起点", (_label, change) => {
    remainsAtSecondDominant(fullExample(change));
  });

  it("双声部虽都级进折回，中段发全 C/G 时保留竞争解释", () => {
    remainsAtSecondDominant(fullExample({
      soprano: "D5/8 E5/8 D5/8",
      alto: "G4/4.",
      tenor: "B3/8 C4/8 B3/8",
      harmony: "V/8 r/8 V/8",
    }));
  });

  it("中间已有和弦标注时尊重实际和弦链", () => {
    remainsAtSecondDominant(fullExample({ harmony: "V7/8 IV/8 V7/8" }));
  });

  it("明确句界位于缺口内部时不从前一句借入起点", () => {
    const project = fullExample();
    project.structure.phraseBoundaries.push({ id: "manual-edge", tick: 720, source: "manual", confidence: "certain" });
    remainsAtSecondDominant(project);
  });

  it("调号在缺口内改变时不从原调借入起点", () => {
    const project = fullExample();
    project.keyEvents.push({ ...project.keyEvents[0], id: "changed-key", tick: 720 });
    remainsAtSecondDominant(project);
  });

  it("同一装饰若处在小节头，不作为弱位双辅助音桥接", () => {
    const project = fullExample();
    project.meterEvents[0] = { ...project.meterEvents[0], numerator: 1 };
    remainsAtSecondDominant(project);
  });
});
