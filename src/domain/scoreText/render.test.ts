import { describe, expect, it } from "vitest";
import sample from "../../../StandardCase/Samples/annotated-cadence.satbt?raw";
import { compileScoreText, renderScoreText } from "./index";


describe("SATB 文本谱", () => {
  it("明确显示同音重奏、延续、休止和精确时值，默认隐藏参考答案与内部 ID", () => {
    const compiled = compileScoreText(sample);
    const output = renderScoreText(compiled.project);
    expect(output).toContain("G3/2 | ~G3 | G3/2");
    expect(output).toContain("chord c2 range=[1:3,2:1) symbol=V");
    expect(output).not.toContain("REFERENCE");
    expect(output).not.toContain("kind=full");
    expect(output).not.toContain(compiled.project.id);
    expect(output).not.toContain(compiled.project.satbTracks[0].notes[0].id);
    const withReference = renderScoreText(compiled.project, { reference: compiled.reference });
    expect(withReference).toContain("REFERENCE (not input)");
    expect(withReference).toContain("cadence range=[1:3,3:1) kind=full form=authentic completion=perfect");
    expect(renderScoreText(compiled.project, { includeIds: true })).toContain("id=note-S-0");
  });

  it("片段视图保留长音的拼写和跨片段标注的完整范围", () => {
    const source = `satb 1\nkey F# minor\nbars 1..2 {\nS: | E#4/1~ | E#4/1 |\nA: empty\nT: empty\nB: empty\n}\nreference {\nphrase p1 range=[1:1,3:1)\n}`;
    const compiled = compileScoreText(source);
    const output = renderScoreText(compiled.project, { fromBar: 2, toBar: 2, reference: compiled.reference });
    expect(output).toContain("~E#4");
    expect(output).not.toContain("F4");
    expect(output).toContain("phrase p1 range=[1:1,3:1)");
    expect(output).toMatch(/A\s+\| r/);
    expect(output).toContain("key @1:1 F# minor");
  });

  it("复杂节奏不会量化到显示网格，列数有界且每页有明确结束位置", () => {
    const source = `satb 1\nbars 1..1 {\nS: | C4/t17 r/t3823 |\nA: empty\nT: empty\nB: empty\n}`;
    const output = renderScoreText(compileScoreText(source).project, { maxColumns: 2 });
    expect(output).toContain("C4/t17");
    expect(output).toContain("1:1+17/960");
    expect(output).toContain("end @2:1");
    expect(output.split("\n").filter((line) => line.startsWith("pos |")).length).toBeGreaterThan(1);
  });

  it("拒绝无效范围及属于另一工程的参考答案", () => {
    const a = compileScoreText(sample);
    const b = compileScoreText(sample);
    expect(() => renderScoreText(a.project, { fromBar: 0 })).toThrow(/范围/);
    expect(() => renderScoreText(a.project, { reference: b.reference })).toThrow(/不一致/);
  });
});
