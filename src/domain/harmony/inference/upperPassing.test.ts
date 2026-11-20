import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";

function score(tenor = "C4/4. D4/8 E4/4", alto = "C5/2 C5/4", bass = "A2/2 G2/4") {
  return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E5/2 G5/4 |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}`).project;
}

describe("One weak upper passing note over a complete held triad", () => {
  it("recovers the minor triad under a passing tenor and writes only the intervening note", () => {
    const project = score(), result = inferChords(project);
    const id = project.satbTracks[2].notes[1].id;
    expect(result.regions.find(r => r.fromTick <= 1440 && r.toTick > 1440)?.selected)
      .toMatchObject({ identity: { root: { step: "A" }, bass: { step: "A" } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: { [id]: "passing" } } });
    expect(result.regions.find(r => r.fromTick === 1920)?.selected?.identity.root.step).toBe("C");
    for (const write of [false, true]) {
      const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks.flatMap(t => t.notes).filter(n => n.nonChordToneRole)
        .map(n => n.id)).toEqual(write ? [id] : []);
    }
  });

  it.each([
    ["neighbor", "C4/4. D4/8 C4/4", "C5/2 C5/4"],
    ["wrong octave", "C4/4. D4/8 E3/4", "C5/2 C5/4"],
    ["handoff to another voice", "C4/4. D4/8 G3/4", "C5/2 E4/4"],
    ["another attack", "C4/4. D4/8 E4/4", "C5/4. C5/8 C5/4"],
    ["missing third of the anchor", "C4/4. D4/8 E4/4", "A4/2 C5/4"],
    ["stronger middle", "C4/8 C4/8 D4/8 E4/4.", "C5/2 C5/4"],
  ])("leaves the passing role unset with %s", (_label, tenor, alto) => {
    const result = inferChords(score(tenor, alto));
    expect(result.regions.flatMap(r => Object.values(r.selected?.fit.nonChordToneAssignments ?? {}))).not.toContain("passing");
  });

  it("respects strict confidence, disabled ornaments and intervening phrase cuts", () => {
    const project = score(), id = project.satbTracks[2].notes[1].id;
    for (const options of [{ minConfidence: "high" as const }, { allowNonChordToneCandidates: false }]) {
      expect(inferChords(project, options).regions.some(r => r.selected?.fit.nonChordToneAssignments[id])).toBe(false);
    }
    for (const tick of [1200, 1440, 1820, 1920]) {
      project.structure.phraseBoundaries = [{ id: "boundary", source: "manual", confidence: "certain", tick }];
      expect(inferChords(project).regions.some(r => r.selected?.fit.nonChordToneAssignments[id])).toBe(false);
    }
  });
});
