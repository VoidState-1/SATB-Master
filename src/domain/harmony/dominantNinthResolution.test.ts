import { describe, expect, it } from "vitest";
import { chordDraftFromIdentity } from "../chordModel";
import { updateChordRegion } from "../editing";
import { compileScoreText } from "../scoreText";
import { checkHarmony } from "./registry";

function withWrittenSmallNinth(text: string) {
  const { project } = compileScoreText(text);
  const source = project.chordTrack.regions.find(chord =>
    chord.identity.structure.kind === "tertian" && chord.identity.structure.extensions.includes(9))!;
  const draft = chordDraftFromIdentity(source.identity, source.semantics!);
  const result = updateChordRegion(project, source.id, { draft: { ...draft, alterations: [{ degree: 9, alter: -1 }] } });
  expect(result.error).toBeUndefined();
  return result.project;
}

const ninthWarnings = (project: ReturnType<typeof withWrittenSmallNinth>) =>
  checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.dominant-ninth");

const prepared = (soprano: string, tenor: string) => `satb 1
key C minor
meter 3/4
bars 1..1 {
 S: | Ab4/2 ${soprano}/4 |
 A: | F4/2 Eb4/4 |
 T: | C4/4 B3/4 ${tenor}/4 |
 B: | F2/4 G2/4 C3/4 |
 H: | s/4 V9/4 t/4 |
}`;

describe("E.3 checks the saved written dominant ninth", () => {
  it("recognizes the prepared resolution of ex. 23–319 and reports a changed landing", () => {
    expect(ninthWarnings(withWrittenSmallNinth(prepared("G4", "C4")))).toEqual([]);
    const wrong = withWrittenSmallNinth(prepared("C5", "G3"));
    expect(ninthWarnings(wrong)).toMatchObject([{ tick: wrong.ppq * 2, voiceIds: ["soprano"] }]);
    const { chordTrack } = wrong;
    expect(ninthWarnings({ ...wrong, chordTrack: { ...chordTrack, regions: chordTrack.regions.slice(0, 2) } })).toEqual([]);
    expect(checkHarmony(wrong).diagnostics.map(item => item.ruleId)).not.toContain("resolution.altered-tone");
  });

  it.each([
    ["同根 9–8", "G4", "F4", "B3", "G2", "D7", 0],
    ["同根九音到七音", "F4", "D4", "B3", "G2", "D7", 0],
    ["下行减三度", "F#4", "C4", "A3", "D3", "V7/V", 1],
  ])("核对%s", (_name, arrival, alto, tenor, bass, harmony, expected) => {
    const project = withWrittenSmallNinth(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | Ab4/4 ${arrival}/4 |
 A: | F4/4 ${alto}/4 |
 T: | B3/4 ${tenor}/4 |
 B: | G2/4 ${bass}/4 |
 H: | V9/4 ${harmony}/4 |
}`);
    expect(ninthWarnings(project)).toHaveLength(expected);
  });
});
