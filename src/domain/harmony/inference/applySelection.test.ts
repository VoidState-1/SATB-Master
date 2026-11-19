import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyChordInference, inferChords } from "./index";

function scoreWithRole(role: string) {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
  S: | C5/2 | C5/2 | C5/4. D5/8@extra |
  A: | G4/2 | G4/2 | G4/2 |
  T: | E4/2 | E4/2 | E4/2 |
  B: | C3/2 | C3/2 | C3/2 |
}
annotations {
  note extra role=${role}
}`).project;
}

function extraNote(project: ReturnType<typeof scoreWithRole>) {
  return project.satbTracks.find(track => track.voice === "soprano")!.notes.at(-1)!;
}

describe("选区内非和弦音角色写回", () => {
  it.each(["anticipation", "passing", "suspension"])("%s 仅写回在选区内起奏的音符", role => {
    const project = scoreWithRole(role);
    const note = extraNote(project);
    expect(note.startTick).toBe(5280);

    // Use an inferred assignment with known evidence to exercise writing the
    // role to a destination note that does not already have that role.
    const target = structuredClone(project);
    delete extraNote(target).nonChordToneRole;
    const options = { mode: "fill-gaps", writeNonChordToneRoles: true } as const;
    const clipped = inferChords(project, { fromTick: 5400, toTick: 5460 });
    expect(clipped.regions[0]?.selected?.fit.nonChordToneAssignments).toEqual({ [note.id]: role });
    const outsideAttack = applyChordInference(target, clipped, options);
    expect(outsideAttack.appliedRegionCount).toBe(1);
    expect(outsideAttack.project.chordTrack.regions[0]).toMatchObject({ startTick: 5400, durationTicks: 60 });
    expect(outsideAttack.writtenNonChordToneRoleCount).toBe(0);
    expect(extraNote(outsideAttack.project).nonChordToneRole).toBeUndefined();

    const includesAttack = inferChords(project, { fromTick: 5280, toTick: 5400 });
    const insideAttack = applyChordInference(target, includesAttack, options);
    expect(insideAttack.appliedRegionCount).toBe(1);
    expect(insideAttack.writtenNonChordToneRoleCount).toBe(1);
    expect(extraNote(insideAttack.project).nonChordToneRole).toBe(role);
  });
});
