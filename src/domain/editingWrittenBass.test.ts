import { expect, it } from "vitest";
import { compileScoreText } from "./scoreText";
import { updateChordRegion } from "./editing";

it("允许编辑绝对和弦的实写转位，保持根音和未定功能", () => {
  const { project } = compileScoreText(`satb 1
key F# major
meter 3/4
bars 1..1 {
 S: | D#5/2. |
 A: | F#4/2. |
 T: | B#3/2. |
 B: | G##2/2. |
}`);
  project.chordTrack.regions = [{
    id: "written", startTick: 0, durationTicks: 2880, locked: false,
    identity: { root: { step: "G", alter: 2 }, bass: { step: "G", alter: 2 },
      structure: { kind: "tertian", quality: "diminished7", extensions: [], alterations: [] } },
  }];
  const edit = updateChordRegion(project, "written", { writtenBass: { step: "F", alter: 1 } });
  expect(edit.error).toBeUndefined();
  expect(edit.project.chordTrack.regions[0].identity).toMatchObject({
    root: { step: "G", alter: 2 }, bass: { step: "F", alter: 1 },
  });
  expect(edit.project.chordTrack.regions[0].semantics).toBeUndefined();
  expect(updateChordRegion(project, "written", { writtenBass: { step: "A", alter: 0 } }).error).toBeDefined();
  project.chordTrack.regions[0].locked = true;
  expect(updateChordRegion(project, "written", { writtenBass: { step: "F", alter: 1 } }).error).toBeDefined();
});
