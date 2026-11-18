import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { defaultHarmonyRuleSeverities } from "../catalog";

function localCadence(sopranoLanding = "A4", localKey = "A major") {
  return compileScoreText(`satb 1
key F major
meter 2/4
bars 1..2 {
 S: | G#4/2 | ${sopranoLanding}/2 |
 A: | E4/2 | C#4/2 |
 T: | B3/2 | E4/2 |
 B: | E3/2 | A2/2 |
}
annotations {
 chord d range=[1:1,2:1) symbol=D localKey="${localKey}"
 chord t range=[2:1,3:1) symbol=T localKey="${localKey}"
}`).project;
}

describe("明示局部调性中的导音识别", () => {
  it("按局部 A 大调核对 G# 到 A，不把工程 F 大调的 E 当导音", () => {
    const diagnostics = checkHarmony(localCadence()).diagnostics;
    expect(diagnostics.filter(item => item.ruleId === "resolution.leading-tone")).toEqual([]);
  });

  it("仍报告局部调性中真正未解决的 G#，并保留目标主音 A", () => {
    const diagnostics = checkHarmony(localCadence("F#4")).diagnostics
      .filter(item => item.ruleId === "resolution.leading-tone");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].voiceIds).toContain("soprano");
    expect(diagnostics[0].debug?.obligation?.partitionKey).toBe("voice:soprano|target:A:0");
  });

  it("不把局部 A 大调属和弦的重复根音 E 当成重复导音", () => {
    const diagnostics = checkHarmony(localCadence()).diagnostics
      .filter(item => item.ruleId === "chord.doubled-leading-tone");
    expect(diagnostics).toHaveLength(0);
  });

  it("仍报告局部 A 大调真正重复的 G# 导音", () => {
    const project = localCadence();
    project.satbTracks.find(track => track.voice === "alto")!.notes[0].pitch = { step: "G", alter: 1, octave: 4 };
    const diagnostics = checkHarmony(project).diagnostics
      .filter(item => item.ruleId === "chord.doubled-leading-tone");
    expect(diagnostics).toHaveLength(1);
    expect(new Set(diagnostics[0].voiceIds)).toEqual(new Set(["soprano", "alto"]));
  });
});

const doubledLeading = "chord.doubled-leading-tone";
const doubledAltered = "chord.doubled-altered-tendency-tone";

function appliedVoicing(
  key: string,
  symbol: string,
  [soprano, alto, tenor, bass]: string[],
  localKey?: string,
) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${soprano}/2 |
 A: | ${alto}/2 |
 T: | ${tenor}/2 |
 B: | ${bass}/2 |
}
annotations {
 chord source range=[1:1,2:1) symbol=${symbol}${localKey ? ` localKey="${localKey}"` : ""}
}`).project;
}

function repeatedTendencyDiagnostics(project: ReturnType<typeof appliedVoicing>, disabled?: typeof doubledLeading | typeof doubledAltered) {
  const severities = defaultHarmonyRuleSeverities();
  if (disabled) severities[disabled] = "off";
  return checkHarmony(project, severities).diagnostics.filter(({ ruleId }) =>
    ruleId === doubledLeading || ruleId === doubledAltered,
  );
}

describe("副属与副导和弦的目标调重复导音", () => {
  it.each([
    { symbol: "V64/VI", pitches: ["B4", "G#4", "E4", "B2"] },
    { symbol: "viio6/VI", pitches: ["B4", "G#4", "D4", "B2"] },
  ])("$symbol 中本调 B 的重复仍是目标调的普通和弦音", ({ symbol, pitches }) => {
    expect(repeatedTendencyDiagnostics(appliedVoicing("C major", symbol, pitches))).toEqual([]);
  });

  it.each([
    { key: "G major", symbol: "V6/II", pitches: ["G#4", "E4", "B3", "G#3"], localKey: undefined, voices: ["bass", "soprano"] },
    { key: "Bb major", symbol: "viio6/IV", pitches: ["D5", "Ab4", "D4", "F3"], localKey: undefined, voices: ["soprano", "tenor"] },
    { key: "C major", symbol: "V6/II", pitches: ["D5", "Bb4", "F4", "D3"], localKey: "Db major", voices: ["bass", "soprano"] },
    { key: "C major", symbol: "viio6/III", pitches: ["B#4", "F#4", "B#3", "D#3"], localKey: "A major", voices: ["soprano", "tenor"] },
  ])("$key $symbol 的目标导音只产生一条诊断，两个单规则均可检测", ({ key, symbol, pitches, localKey, voices }) => {
    const fresh = () => appliedVoicing(key, symbol, pitches, localKey);
    expect(repeatedTendencyDiagnostics(fresh()).map(d => d.ruleId)).toEqual([doubledAltered]);
    expect(repeatedTendencyDiagnostics(fresh(), doubledLeading).map(d => d.ruleId)).toEqual([doubledAltered]);
    expect(repeatedTendencyDiagnostics(fresh(), doubledAltered)).toEqual([
      expect.objectContaining({ ruleId: doubledLeading, voiceIds: voices, severity: "error" }),
    ]);
  });

  it("小调本调的升 VII 仍由 D.8 检测", () => {
    const project = appliedVoicing("A minor", "D", ["G#4", "G#3", "B3", "E3"]);
    expect(repeatedTendencyDiagnostics(project)).toEqual([
      expect.objectContaining({ ruleId: doubledLeading, voiceIds: ["alto", "soprano"] }),
    ]);
  });

  it("同一副属中另一种方向性变化音仍独立报告", () => {
    const project = appliedVoicing("G major", "V6/II", ["G#4", "B#4", "B#3", "G#3"]);
    const { structure } = project.chordTrack.regions[0].identity;
    if (structure.kind !== "tertian") throw Error("预期三度叠置和弦");
    structure.alterations = [{ degree: 5, alter: 1, tendency: "up" }];
    const diagnostics = repeatedTendencyDiagnostics(project);
    expect(diagnostics.map(d => d.ruleId)).toEqual([doubledAltered, doubledAltered]);
    expect(diagnostics.map(d => d.params.degree).sort()).toEqual([5, 7]);
  });

  it("原位副属只让位于实际目标导音的重复诊断", () => {
    const doubling = "chord.triad-root-position-doubling";
    const check = (pitches: string[]) => checkHarmony(appliedVoicing("C major", "V/VI", pitches)).diagnostics;
    const fifthDoubled = check(["B4", "G#4", "B3", "E3"]);
    expect(fifthDoubled.some(d => d.ruleId === doubling)).toBe(true);
    const leadingDoubled = check(["G#5", "B4", "G#4", "E3"]);
    expect(leadingDoubled.some(d => d.ruleId === doubling)).toBe(false);
    expect(leadingDoubled.some(d => d.ruleId === doubledAltered)).toBe(true);
  });
});
