import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { applyChordEditorAction } from "../../domain/chordEditorModel";
import { chordDraftFromRegion } from "../../domain/chords";
import { updateChordRegion } from "../../domain/editing";
import { compileScoreText } from "../../domain/scoreText";
import { SelectionInspector } from "./SelectionInspector";

it.each([true, false])("Inspector 显示手工升五属七的第一转位（选中和弦 %s）", selected => {
  const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: empty
  A: empty
  T: empty
  B: empty
  H: | D7/2 |
}`);
  const source = project.chordTrack.regions[0];
  const key = project.keyEvents[0];
  const inverted = applyChordEditorAction(chordDraftFromRegion(source)!, key, {
    type: "set-inversion", inversion: 1,
  });
  const draft = applyChordEditorAction(inverted, key, {
    type: "set-tone-alteration",
    choice: { label: "♯5", degree: 5, alter: 1, tendency: "up" },
  });
  const edited = updateChordRegion(project, source.id, { draft });
  expect(edited.error).toBeUndefined();
  const chord = edited.project.chordTrack.regions[0];
  const noop = () => {};

  const html = renderToStaticMarkup(<SelectionInspector project={edited.project}
    selectedChord={selected ? chord : undefined}
    selectedChordIds={new Set(selected ? [chord.id] : [])} selectedChordCount={Number(selected)}
    developerMode={false} chordBrush={draft} playheadTick={0}
    onUpdateNote={noop} onUpdateChord={noop} onDeleteChords={noop} onUpdateChordBrush={noop} />);

  expect(html.match(/<div class="computed-chord-name"><strong>([^<]+)<\/strong><span>([^<]+)<\/span>/)?.slice(1))
    .toEqual(["D56(♯5)", "V6/5(♯5) · G7(♯5)/B"]);
});
