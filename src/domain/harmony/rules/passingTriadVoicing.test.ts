import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";

const root = "chord.triad-root-position-doubling", first = "chord.first-inversion-doubling";
function triad({ tenor = "C4/4. D4/8 E4/4", alto = "C5/2 C5/4", bass = "A2/2 G2/4",
    soprano = "E5/2 G5/4", harmony = "vi/2 I64/4" } = {}) {
  const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
  H: | ${harmony} |
}`);
  project.satbTracks[2].notes[1].nonChordToneRole = "passing";
  return project;
}
function findings(project: ReturnType<typeof triad>, rule: string) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === rule && d.tick < 1920);
}
describe("Closing upper passing tone in triad doubling", () => {
  it("reports the actual doubled third at its original onset and end", () => {
    expect(findings(triad(), root)).toMatchObject([{ tick: 0, endTick: 1440, params: { counts: "1/2/1" } }]);
    const inversion = triad({ alto: "A4/2 C5/4", bass: "C3/2 G2/4", harmony: "vi6/2 I64/4" });
    expect(findings(inversion, first)).toMatchObject([{ tick: 0, endTick: 1440, params: { counts: "1/2/1" } }]);
  });
  it("retains the doubled root in the last structural first-inversion voicing", () => {
    const p = triad({ tenor: "A3/4. B3/8 C4/4", alto: "A4/2 E4/4", bass: "C3/2 G2/4", harmony: "vi6/2 I64/4" });
    expect(findings(p, first)).toEqual([]);
  });
  it.each([
    ["wrong direction", "C4/4. D4/8 C4/4", "C5/2 C5/4"],
    ["other voice supplies E", "C4/4. D4/8 G3/4", "C5/2 E4/4"],
    ["reattack in the accompaniment", "C4/4. D4/8 E4/4", "C5/4. C5/8 C5/4"],
  ])("keeps the surface diagnostic with %s", (_reason, tenor, alto) => {
    expect(findings(triad({ tenor, alto }), root)).toMatchObject([{ tick: 1440 }]);
  });
  it("keeps the literal reading of a fully spelled seventh despite a passing label", () => {
    // V6 with a seventh in the tenor, G4–F4–E4 in C major.
    const p = triad({ tenor: "G4/4. F4/8 E4/4", soprano: "D5/2 G5/4",
      alto: "G4/2 C5/4", bass: "B2/2 C3/4", harmony: "V6/2 I/4" });
    expect(findings(p, first)).toMatchObject([{ tick: 1440 }]);
  });
  it("keeps the surface diagnostic when the role is absent or a phrase separates the landing", () => {
    const unmarked = triad();
    delete unmarked.satbTracks[2].notes[1].nonChordToneRole;
    expect(findings(unmarked, root)).toMatchObject([{ tick: 1440 }]);
    const p = triad();
    p.structure.phraseBoundaries = [{ id: "boundary", source: "manual", confidence: "certain", tick: 1920 }];
    expect(findings(p, root)).toMatchObject([{ tick: 1440 }]);
  });
});
