import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { applyChordEditorAction } from "../../domain/chordEditorModel";
import { chordDraftFromRegion } from "../../domain/chords";
import { addAuxiliaryTrack, addNote, updateChordRegion } from "../../domain/editing";
import { createEmptyProject, type NoteEvent } from "../../domain/project";
import { compileScoreText } from "../../domain/scoreText";
import { SelectionInspector } from "./SelectionInspector";

it.each(["satb", "auxiliary"] as const)("Inspector 显示 %s 音符的属性和开发者字段", (kind) => {
  const initial = createEmptyProject();
  const trackResult = addAuxiliaryTrack(initial, { name: "弦乐", color: "#224466" });
  const voiceId = kind === "auxiliary" ? trackResult.trackId! : "soprano";
  const note: NoteEvent = {
    id: "selected-note",
    startTick: 0,
    durationTicks: initial.ppq,
    pitch: { step: "F", alter: 1, octave: 4 },
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
  const { project } = addNote(trackResult.project, voiceId, note);
  const noop = () => {};
  const html = renderToStaticMarkup(
    <SelectionInspector
      project={project}
      selectedNote={{ voiceId, note }}
      selectedChordIds={new Set()}
      selectedChordCount={0}
      developerMode
      chordBrush={{
        degree: 1, degreeAlteration: 0, quality: "major", inversion: 0,
        source: "manual", confidence: "certain",
      }}
      playheadTick={0}
      onUpdateNote={noop}
      onUpdateChord={noop}
      onDeleteChords={noop}
      onUpdateChordBrush={noop}
    />,
  );
  expect(html).toContain(kind === "auxiliary" ? "音符 · 弦乐" : "音符 · 女高音");
  expect(html).toContain(kind === "auxiliary" ? "background:#224466" : "background:#7552a3");
  expect(html).toContain(`${kind === "auxiliary" ? "auxiliaryTracks" : "satbTracks"}.${voiceId}.notes`);
  for (const label of ["音名", "升降号", "同音异名", "八度", "实际音高（MIDI）", "起点（tick）", "时值（tick）", "力度", "锁定音符"]) {
    expect(html).toContain(label);
  }
  if (kind === "auxiliary") {
    expect(html).toContain("额外声部不参与和声检查");
    expect(html).not.toContain("非和弦音角色");
  } else {
    expect(html).toContain("非和弦音角色");
  }
});

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
