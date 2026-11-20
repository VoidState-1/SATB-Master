import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function example({
  soprano = "C#5/4 B#4/4~ | B#4/4 C#5/4 | B4/2",
  alto = "E4/4 D#4/4~ | D#4/4 E4/4 | E4/2",
  tenor = "A3/2~ | A3/2 | G#3/2",
  bass = "A2/4 F3/4 | E3/2 | E3/2",
  source = "DD++43",
  middle = "K46/2",
  boundary,
  keyChange = false,
}: {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  source?: string;
  middle?: string;
  boundary?: number;
  keyChange?: boolean;
} = {}) {
  const { project } = compileScoreText(`satb 1
key A major
meter 2/4
bars 1..3 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | I/4 ${source}/4 | ${middle} | V/2 |
}`);
  if (boundary !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "test-boundary", tick: boundary * project.ppq, source: "manual", confidence: "certain",
    });
  }
  if (keyChange) {
    project.keyEvents.push({
      id: "other-key", tick: 3 * project.ppq, tonic: { step: "E", alter: 0 }, mode: "major",
    });
  }
  return project;
}

function errors(project: ReturnType<typeof example>, ruleId = "resolution.augmented-sixth") {
  return checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === ruleId);
}

describe("倍增三四进入同一主四六的二重有准备延留", () => {
  it("升二和升四连持到弱拍，低音在强拍先到且保持到解决", () => {
    expect(errors(example())).toEqual([]);
  });

  it("立即解决走原路径，普通主四六记法也可凭实音证明延期", () => {
    expect(errors(example({
      soprano: "C#5/4 B#4/4 | C#5/2 | B4/2",
      alto: "E4/4 D#4/4 | E4/2 | E4/2",
    }))).toEqual([]);
    expect(errors(example({ middle: "I64/2" }))).toEqual([]);
  });

  it.each([
    ["升四在原位朝错方向走", { alto: "E4/4 D#4/4~ | D#4/4 D4/4 | E4/2" }],
    ["升二到错误八度", { soprano: "C#5/4 B#4/4~ | B#4/4 C#4/4 | B4/2" }],
    ["声部重起同音", { alto: "E4/4 D#4/4 | D#4/4 E4/4 | E4/2" }],
    ["低音延留中换八度", { bass: "A2/4 F3/4 | E3/4 E2/4 | E3/2" }],
    ["主音在延留中途重奏", { tenor: "A3/2~ | A3/4 A3/4 | G#3/2" }],
    ["主四六在解决前结束", { middle: "K46/4 V/4" }],
    ["目标标签是普通属和弦", { middle: "V/2" }],
    ["没有同一目标内的任何后继", {
      soprano: "C#5/4 B#4/4~ | B#4/2 | B4/2",
      alto: "E4/4 D#4/4~ | D#4/2 | E4/2",
    }],
    ["源拍内部有手动句界", { boundary: 1.5 }],
    ["解决拍有手动句界", { boundary: 3 }],
    ["解决拍发生调号变化", { keyChange: true }],
  ] satisfies Array<[string, Parameters<typeof example>[0]]>)("%s 时保留落点错误", (_name, changes) => {
    const project = example(changes);
    expect(errors(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
  });

  it("终点虽有正确实音，延至同一小节第三拍仍保留错误", () => {
    const project = compileScoreText(`satb 1
key D major
meter 4/4
bars 1..2 {
 S: | F#5/2. E#5/4~ | E#5/2 F#5/2 |
 A: | A4/2. G#4/4~ | G#4/2 A4/2 |
 T: | D4/1~ | D4/1 |
 B: | D3/2. Bb2/4 | A2/1 |
 H: | I/2. DD++43/4 | K46/1 |
}`).project;
    expect(errors(project)).toEqual([expect.objectContaining({ tick: 4 * project.ppq })]);
  });

  it("误给同响德增六的标签不构成延期证据，配置错误仍在", () => {
    const project = example({ source: "Ger+6" });
    expect(errors(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    expect(errors(project, "chord.augmented-sixth-voicing")).toHaveLength(1);
  });
});
