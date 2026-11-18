import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

function reading(s: string, a: string, t: string, b: string) {
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
describe("离调的属和弦", () => {
  it("离调减七按实写导音同声部上行半音至局部主音判读", () => {
    const [vii] = reading("Bb4/2 A4/2", "G4/2 F4/2", "E4/2 D4/2", "C#3/2 D3/2");
    expect(vii).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "C", alter: 1 }, structure: { quality: "diminished7" } },
      semantics: { interpretations: [{ degree: 7, appliedTarget: { degree: 2 } }] },
    } });
  });
  it("目标三和弦换位、原导音同声部跳开时不指派副导七", () => {
    const [vii] = reading("Bb4/2 A4/2", "G4/2 F4/2", "E4/2 D4/2", "C#3/2 F3/2");
    expect(vii.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
  it("半音化的 A7/C# 解决到 D 小三和弦，仍使用原调与明确的目标级数", () => {
    const [v, ii] = reading("G4/2 F4/2", "E4/2 D4/2", "A3/1", "C#3/2 D3/2");
    expect(v).toMatchObject({ status: "resolved", selected: { identity: { root: { step: "A" }, bass: { step: "C", alter: 1 } },
      semantics: { interpretations: [{ degree: 5, appliedTarget: { degree: 2 } }] } } });
    expect(ii.selected?.functionalBaseId).toBe("SII");
  });
  it("谱面缺少后续解决时保留孤立的半音和弦未定", () => {
    const [v] = reading("G4/1", "E4/1", "A3/1", "C#3/1");
    expect(v.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
  it("调内 T–S 保留主和弦读法", () => {
    const [t] = reading("G4/2 A4/2", "E4/2 F4/2", "C4/1", "C3/2 F2/2");
    expect(t.selected?.functionalBaseId).toBe("T");
    expect(t.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
});

