import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createChordRegion, defaultChordDraftAtTick } from "../../domain/chords";
import { createEmptyProject, PPQ } from "../../domain/project";
import { CadenceEditor } from "./CadenceEditor";

it("选择横跨句界的和弦时，可以按小节与拍点选择两边的终止式", () => {
  const project = createEmptyProject();
  const chord = createChordRegion(project, PPQ, 2 * PPQ, defaultChordDraftAtTick(project, PPQ), "shared");
  project.chordTrack.regions = [chord];
  const base = { source: "manual", confidence: "certain", locked: false } as const;
  project.chordTrack.cadenceAnnotations = [
    { ...base, id: "h", phraseId: "first", fromTick: PPQ, toTick: 2 * PPQ, kind: "half" },
    { ...base, id: "f", phraseId: "second", fromTick: 2 * PPQ, toTick: 4 * PPQ, kind: "full" },
  ];
  const html = renderToStaticMarkup(<CadenceEditor project={project} selectedChord={chord} />);
  expect(html).toContain("当前终止式");
  expect(html).toContain("半终止 · 1:2:000 – 1:3:000");
  expect(html).toContain("全终止 · 1:3:000 – 2:1:000");
});
