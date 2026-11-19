import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

const evidenceCode = "local-deceptive-dominant-resolution";

function reading(parts: readonly [string, string, string, string], events = "", bars = 3, phraseTick?: number) {
  const score = `satb 1
key C major
meter 2/4
${events}
bars 1..${bars} {
  S: | ${parts[0]} |
  A: | ${parts[1]} |
  T: | ${parts[2]} |
  B: | ${parts[3]} |
}`;
  const { project } = compileScoreText(score);
  if (phraseTick !== undefined) {
    project.structure.phraseBoundaries.push({ id: "edge", tick: phraseTick, source: "manual", confidence: "certain" });
  }
  const result = inferChords(project);
  return result.regions.find(region => region.fromTick <= 960 && 960 < region.toTick)!;
}

const diatonic = [
  "G4/4 G#4/4 | A4/2 | G4/2",
  "E4/4 D4/4 | C4/2 | E4/2",
  "C4/4 B3/4 | A3/2 | C4/2",
  "C3/4 E3/4 | F3/2 | C3/2",
] as const;
const chromatic = [
  "G4/4 F##4/4 | G#4/2 | B4/2",
  "E4/4 C#4/4 | B3/2 | G#4/2",
  "C4/4 A#3/4 | G#3/2 | D#4/2",
  "C3/4 D#3/4 | E3/2 | D#3/2",
] as const;

function lacksDeceptiveEvidence(region: ReturnType<typeof reading>) {
  for (const candidate of [region.selected, ...region.alternatives]) {
    expect(candidate?.evidence.some(evidence => evidence.code === evidenceCode)).not.toBe(true);
  }
}

describe("完整原位属七的局部阻碍进行", () => {
  it("C 大调的 E7 可按指向 vi 的副属进入 a 小调 VI，保留实写根低音", () => {
    const region = reading(diatonic);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "E", alter: 0 }, bass: { step: "E", alter: 0 }, structure: { quality: "dominant7" } },
      semantics: { interpretations: [{ appliedTarget: { degree: 6 } }] },
    } });
    expect(region.selected?.evidence.some(evidence => evidence.code === evidenceCode)).toBe(true);
  });

  it("谱面稍后出现同拼写的小主三和弦时，支持非调内目标的局部读法", () => {
    const region = reading(chromatic);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "D", alter: 1 }, structure: { quality: "dominant7" } },
      semantics: { interpretations: [{ localKey: { tonic: { step: "G", alter: 1 }, mode: "minor" } }] },
    } });
    expect(region.selected?.evidence.some(evidence => evidence.code === evidenceCode)).toBe(true);
    expect(region.selected?.evidence.some(evidence => evidence.code === "local-key-cadence")).toBe(false);
  });

  it.each([
    ["属七五音跳到目标八度", [diatonic[0], diatonic[1], "C4/4 B3/4 | A4/2 | C4/2", diatonic[3]]],
    ["另一个声部降八度后位于实谱低音下方", [diatonic[0], "E4/4 D4/4 | C3/2 | E4/2", diatonic[2], diatonic[3]]],
    ["三条解决均为级进但有声部处在名义低音下方", [diatonic[0], diatonic[1], "C4/4 B2/4 | A2/2 | C4/2", diatonic[3]]],
    ["落点不重三音", [diatonic[0], diatonic[1], "C4/4 B3/4 | C4/2 | C4/2", diatonic[3]]],
    ["七音未在原声部下行", [diatonic[0], "E4/4 D4/4 | A3/2 | E4/2", "C4/4 B3/4 | C4/2 | C4/2", diatonic[3]]],
    ["同音异名的变化音", ["G4/4 Ab4/4 | A4/2 | G4/2", diatonic[1], diatonic[2], diatonic[3]]],
    ["省掉属七的五音", [diatonic[0], diatonic[1], "C4/4 E4/4 | A3/2 | C4/2", diatonic[3]]],
    ["源低音是属七的五音", [diatonic[0], diatonic[1], "C4/4 E3/4 | A3/2 | C4/2", "C3/4 B2/4 | F3/2 | C3/2"]],
    ["非调内目标只出现同主音大三和弦", ["G4/4 F##4/4 | G#4/2 | B#4/2", chromatic[1], chromatic[2], chromatic[3]]],
  ] satisfies (readonly [string, readonly [string, string, string, string]])[])("拒绝%s", (_name, parts) => {
    lacksDeceptiveEvidence(reading(parts));
  });

  it("不跨过实际调号边界", () => {
    lacksDeceptiveEvidence(reading(diatonic, "at 2:1 key A minor"));
  });

  it("非调内小主超过两拍才出现时，不使用该解读", () => {
    lacksDeceptiveEvidence(reading([
      "G4/4 F##4/4 | G#4/2 | G4/2 | B4/2",
      "E4/4 C#4/4 | B3/2 | E4/2 | G#4/2",
      "C4/4 A#3/4 | G#3/2 | C4/2 | D#4/2",
      "C3/4 D#3/4 | E3/2 | C3/2 | D#3/2",
    ], "", 4));
  });

  it.each([1440, 1920])("实际句界 %s 切断源与 VI", tick => {
    lacksDeceptiveEvidence(reading(diatonic, "", 3, tick));
  });

  it("同拼写非调内小主在句界或实际调号后也不充当同句锚点", () => {
    lacksDeceptiveEvidence(reading(chromatic, "", 3, 2400));
    lacksDeceptiveEvidence(reading(chromatic, "", 3, 3840));
    lacksDeceptiveEvidence(reading(chromatic, "at 3:1 key G# minor"));
  });

  it("已有本调正格解决仍选择原位 G7", () => {
    const region = reading([
      "G4/4 B4/4 | C5/2 | G4/2",
      "E4/4 F4/4 | E4/2 | E4/2",
      "C4/4 D4/4 | C4/2 | C4/2",
      "C3/4 G2/4 | C3/2 | C3/2",
    ]);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "G", alter: 0 }, structure: { quality: "dominant7" } },
    } });
    lacksDeceptiveEvidence(region);
  });
});
