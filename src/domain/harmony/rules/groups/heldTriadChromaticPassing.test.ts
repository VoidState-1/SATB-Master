import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project";
import { checkHarmony } from "../../registry";

const diatonicRun = `satb 1
key A major
meter 2/4
bars 1..2 {
 S: | A4/8 G#4/8 F#4/8 F4/8 | E4/4 A4/4 |
 A: | A3/2~ | A3/4 A3/4 |
 T: | E3/2~ | E3/4 E3/4 |
 B: | C#3/2~ | C#3/4 A2/4 |
}
`;

const preparedNinth = `satb 1
key D minor
meter 3/4
bars 1..3 {
 S: | F5/2 D5/4~ | D5/8 Db5/8 C5/4 G4/4 | F4/2. |
 A: | A4/2 Ab4/4 | G4/2 E4/4 | F4/2. |
 T: | F4/2 F4/4 | E4/2 Bb3/4 | A3/2. |
 B: | D3/2 B2/4 | C3/2. | F2/2. |
}
annotations {
 chord preparation range=[1:3,2:1) symbol=DDVII7 localKey="F major"
 chord dominant range=[2:3,3:1) symbol=V7 localKey="F major"
 chord tonic range=[3:1,4:1) symbol=I localKey="F major"
}
`;

function make(score: string) {
  return compileScoreText(score).project;
}

function warnings(project: ProjectDocument, tick: number) {
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "melody.augmented-interval" && item.tick === tick)
    .map(({voiceIds, params}) => ({voiceIds, semitones:params.semitones}));
}

function expectAugmentedPrime(project: ProjectDocument, tick: number) {
  expect(warnings(project,tick)).toEqual([{voiceIds:["soprano"],semitones:1}]);
}

describe("下降的半音经过收束于三声持续的大三和弦", () => {
  const weakTick = 1440;
  it("允许两个自然经过音之后的变化半音，和弦标签可以缺省", () => {
    expect(warnings(make(diatonicRun),weakTick)).toEqual([]);
  });

  it("相符的给定和弦不改变通过结果", () => {
    expect(warnings(make(diatonicRun + 'annotations {\n chord backing range=[1:1,1:2) symbol=I6\n}\n'),weakTick)).toEqual([]);
  });

  it.each([
    ["伴随声部在变化处重新起奏", (score: string) => score.replace("E3/2~", "E3/4. E3/8~")],
    ["三声部中一音改成别的拼写", (score: string) => score.replace("E3", "Fb3").replace("E3/4", "Fb3/4")],
    ["经过音没有同向到达", (score: string) => score.replace("E4/4", "G#4/4")],
    ["错八度的解决", (score: string) => score.replace("E4/4", "E3/4")],
    ["没有有据的级进引入", (score: string) => score.replace("G#4/8", "B4/8")],
    ["强拍的变化", (score: string) => score.replace("G#4/8 F#4/8 F4/8", "F#4/8 F4/4")],
  ])("%s 时保留警告", (description, edit) => {
    const tick = description === "强拍的变化" ? 960 : weakTick;
    expectAugmentedPrime(make(edit(diatonicRun)),tick);
  });

  it("保留跨手动句界的警告", () => {
    const project=make(diatonicRun);
    project.structure.phraseBoundaries.push({id:"cut",tick:1680,source:"manual",confidence:"certain"});
    expectAugmentedPrime(project,weakTick);
  });

  it("没有被冲突的和弦标签豁免", () => {
    const score=diatonicRun + 'annotations {\n chord conflict range=[1:1,1:2) symbol=I\n}\n';
    expectAugmentedPrime(make(score),weakTick);
  });

  it("第 41 章的降 V 例外不被扩大", () => {
    const wrong=diatonicRun.replace("A4/8 G#4/8 F#4/8 F4/8 | E4/4 A4/4","F#4/8 F#4/8 E4/8 Eb4/8 | D4/4 A4/4")
      .replace("E3/2~ | E3/4 E3/4", "D3/2~ | D3/4 E3/4")
      .replace("C#3/2~ | C#3/4 A2/4","F#2/2~ | F#2/4 A2/4");
    expectAugmentedPrime(make(wrong),weakTick);
  });
});

describe("真实属低音上预备的九度经过半音到八度", () => {
  const weakTick=3360;
  it("允许延音与属和弦的实际解决，并核对由 V7–I 支持的局部大调", () => {
    expect(warnings(make(preparedNinth),weakTick)).toEqual([]);
    expect(warnings(make(preparedNinth.replace(/ chord preparation[^\n]+\n/,"")),weakTick)).toEqual([]);
  });

  it.each([
    ["临时同音重新起奏", (score: string) => score.replace("D5/4~", "D5/4")],
    ["冲突的副属目标标签", (score: string) => score.replace("DDVII7", "viio7/II")],
    ["不成立的七音拼写", (score: string) => score.replace("Ab4/4", "G#4/4")],
    ["实际属七缺三音", (score: string) => score.replace("G4/2 E4/4", "G4/2 D4/4")],
    ["没有终止主功能", (score: string) => score.replace(/ chord tonic[^\n]+\n/,"")],
    ["错误主功能", (score: string) => score.replace('symbol=I localKey="F major"','symbol=ii localKey="F major"')],
    ["属低音在同音区重奏", (score: string) => score.replace("C3/2.", "C3/2 C3/4")],
  ])("%s 时保留警告", (_description, edit) => {
    expectAugmentedPrime(make(edit(preparedNinth)),weakTick);
  });

  it("目标调有歧义或同一持续低音内有句界时仍报告", () => {
    const ambiguous=make(preparedNinth.replace('symbol=V7 localKey="F major"',
      'symbol=V7 localKey="F major" confidence=ambiguous'));
    expectAugmentedPrime(ambiguous,weakTick);
    const cut=make(preparedNinth);
    cut.structure.phraseBoundaries.push({id:"cut",tick:5280,source:"manual",confidence:"certain"});
    expectAugmentedPrime(cut,weakTick);
  });

  const preparationTick=1920;
  const warningInAlto=[{voiceIds:["alto"],semitones:1}];

  it("允许完整 vi 的自然三级在原声部改作重属导七的降三级七音", () => {
    expect(warnings(make(preparedNinth),preparationTick)).toEqual([]);
  });

  it("不以晚到的属和弦代替进入时的完整 vi 或 vi7", () => {
    const foreignPreparation=make(preparedNinth.replace("F5/2 D5/4~","E5/2 D5/4~"));
    expect(warnings(foreignPreparation,preparationTick)).toEqual(warningInAlto);
    expect(warnings(foreignPreparation,weakTick)).toEqual([]);
  });

  it("保留前置功能标签与目标调冲突时的降三级警告", () => {
    const conflict=make(preparedNinth.replace("annotations {\n",
      'annotations {\n chord before range=[1:1,1:3) symbol=iv localKey="A minor"\n'));
    expect(warnings(conflict,preparationTick)).toEqual(warningInAlto);
    expect(warnings(conflict,weakTick)).toEqual([]);
  });

  it("升四不进属根时不能取得重属七音的例外", () => {
    const unresolved=make(preparedNinth.replace("C3/2.","C4/2."));
    expect(warnings(unresolved,preparationTick)).toEqual(warningInAlto);
    expectAugmentedPrime(unresolved,weakTick);
  });
});
