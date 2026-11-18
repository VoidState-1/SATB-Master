import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

function chords(s: string, a: string, t: string, b: string) {
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | ${s} |
  A: | ${a} |
  T: | ${t} |
  B: | ${b} |
}`).project;
  return inferChords(project).regions;
}

describe("依据相邻和弦与实际低音判断四六用途", () => {
  it("弱拍 D–T64–D 按辅助四六写回主功能", () => {
    const middle = chords("D5/4 E5/4 D5/2", "B4/4 C5/4 B4/2", "G3/1", "G2/1")[1];
    expect(middle).toMatchObject({status:"resolved", selected:{functionalBaseId:"T", semantics:{cadenceRole:"pedal64"}}});
  });
  it("连接主和弦原位与第一转位的同向级进识别经过属四六", () => {
    const middle = chords("E5/4 D5/4 C5/2", "C4/4 B3/4 C4/2", "G3/1", "C3/4 D3/4 E3/2")[1];
    expect(middle).toMatchObject({status:"resolved", selected:{functionalBaseId:"D", semantics:{cadenceRole:"passing64"}}});
  });
  it("低音折返不会误标为经过四六", () => {
    const middle = chords("E5/4 D5/4 E5/2", "C4/4 B3/4 C4/2", "G3/1", "C3/4 D3/4 C3/2")[1];
    expect(middle.selected?.semantics?.cadenceRole).toBeUndefined();
  });
  it("同属低音上的强拍四六再奏，后接级进解决时整段带有终止证据", () => {
    const first = chords("E5/8 E5/8 D5/2.", "C4/4 B3/2.", "G3/1", "G2/1")[0];
    expect(first).toMatchObject({status:"resolved", selected:{functionalBaseId:"K46"}});
    expect(first.selected?.evidence).toContainEqual({kind:"sequence-context",code:"cadential64-resolution"});
  });
  it("强拍 K46 经声部换位、低音下跳八度解决到原位 D7，再归主", () => {
    const [first] = chords("E5/2 B4/4 C5/4", "G4/2 F4/4 E4/4", "C4/2 D4/4 G3/4", "G3/2 G2/4 C3/4");
    expect(first).toMatchObject({ status: "resolved", selected: { functionalBaseId: "K46" } });
  });
  it("同属低音上弱拍重新配音省去一音，后接 D–T 仍可确认 K46", () => {
    const [first] = chords("E5/4 G5/4 B4/4 C5/4", "G4/4 E4/4 F4/4 E4/4", "C4/4 E4/4 D4/4 G3/4", "G3/2 G2/4 C3/4");
    expect(first).toMatchObject({ fromTick: 0, toTick: 1920, status: "resolved", selected: { functionalBaseId: "K46" } });
    expect(first.selected?.evidence.map(e => e.code)).toContain("cadential64-revoicing");
  });
});

