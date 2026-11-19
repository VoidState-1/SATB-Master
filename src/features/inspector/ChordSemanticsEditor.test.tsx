import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chordDraftFromIdentity } from "../../domain/chordModel";
import { defaultChordDraftAtTick } from "../../domain/chords";
import { createEmptyProject } from "../../domain/project";
import { compileScoreText } from "../../domain/scoreText";
import { ChordSemanticsEditor } from "./ChordSemanticsEditor";

describe("倍增三四的和弦检查器", () => {
  it("显示四音变和弦及固定低音", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | D#5/4 E5/4 |
 A: | F#4/4 G4/4 |
 T: | C4/2 |
 B: | Ab2/4 G2/4 |
 H: | DD++43/4 K46/4 |
}`);
    const chord = project.chordTrack.regions[0];
    const markup = renderToStaticMarkup(<ChordSemanticsEditor keyEvent={project.keyEvents[0]}
      draft={chordDraftFromIdentity(chord.identity, chord.semantics!)} onChange={vi.fn()} />);
    expect(markup).toContain("重属倍增三四和弦");
    expect(markup).toContain("四音变和弦");
    expect(markup).toContain("降六级低音（固定）");
  });

  it("小调目录不显示大调倍增三四", () => {
    const project = createEmptyProject();
    project.keyEvents[0].mode = "minor";
    const markup = renderToStaticMarkup(<ChordSemanticsEditor keyEvent={project.keyEvents[0]}
      draft={defaultChordDraftAtTick(project, 0)} onChange={vi.fn()} />);
    expect(markup).not.toContain("DD++43");
    expect(markup).toContain("Ger+6");
  });
});
