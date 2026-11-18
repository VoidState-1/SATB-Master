import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultChordDraftAtTick } from "../../../domain/chords";
import { PPQ, type CadenceAnnotation } from "../../../domain/project";
import { compileScoreText } from "../../../domain/scoreText";
import { CadenceEditor } from "../../inspector/CadenceEditor";
import { ChordTrack } from "./ChordTrack";

it("跨句共用的和弦分别列出两个终止的真实拍点，仅完整覆盖的和弦整块着色", () => {
  const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: empty
  A: empty
  T: empty
  B: empty
  H: | T/4 D/4 | D/4 T/4 |
}`);
  const chords = project.chordTrack.regions;
  chords[1].durationTicks += chords[2].durationTicks;
  chords.splice(2, 1);
  const base = { phraseId: "p", source: "manual", confidence: "certain", locked: false } as const;
  const annotations: CadenceAnnotation[] = [
    { ...base, id: "h", fromTick: PPQ, toTick: 2 * PPQ, kind: "half", form: "authentic" },
    { ...base, id: "f", fromTick: 2 * PPQ, toTick: 4 * PPQ, kind: "full", form: "authentic" },
  ];
  project.chordTrack.cadenceAnnotations = annotations;
  const noop = () => {};
  const html = renderToStaticMarkup(<ChordTrack project={project} totalWidth={400} pixelsPerBeat={100}
    tool="select" chordBrush={defaultChordDraftAtTick(project, 0)}
    chordRects={chords.map(region => ({ region, startTick: region.startTick, durationTicks: region.durationTicks, x: 0, width: 100 }))}
    selectedChordIds={new Set()} diagnosticsByChord={new Map()} measureGuidePositions={[]} playheadX={0}
    onPointerDown={noop} onPointerMove={noop} onPointerUp={noop} onPointerCancel={noop} onDoubleClick={noop}
    onShowDiagnosticTooltip={noop} onHideDiagnosticTooltip={noop} />);
  const blocks = [...html.matchAll(/<button[^>]*>/g)].map(match => match[0]);
  expect(blocks[1]).not.toMatch(/cadence-(full|half)/);
  expect(blocks[2]).toContain("cadence-full");
  const inspector = renderToStaticMarkup(<CadenceEditor project={project} selectedChord={chords[1]} />);
  for (const label of ["半终止 · 1:2:000 – 2:1:000", "全终止 · 2:1:000 – 3:1:000"]) {
    expect(blocks[1]).toContain(label);
    expect(inspector).toContain(label);
  }
});
