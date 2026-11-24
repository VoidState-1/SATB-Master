// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAuxiliaryTrack,
  addNote,
  setAuxiliaryTracksScorePreview,
  updateTrack,
} from "../../domain/editing";
import { buildScorePreviewModel } from "../../domain/notation";
import { spellMidi } from "../../domain/pitch";
import { createEmptyProject, type ProjectDocument } from "../../domain/project";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import { ScorePreviewDialog } from "./ScorePreviewDialog";
import { ScorePreviewPane } from "./ScorePreviewPane";
import { ScorePreviewToolbar } from "./ScorePreviewToolbar";
import { loadVexFlow, renderScorePreview } from "./vexflowRenderer";

function addTestNote(
  project: ProjectDocument,
  trackId: string,
  id: string,
  midi: number,
  startTick: number,
  durationTicks: number,
) {
  const result = addNote(project, trackId, {
    id, startTick, durationTicks, pitch: spellMidi(midi),
    velocity: 88, locked: false, spellingSource: "manual",
  });
  expect(result.error).toBeUndefined();
  return result.project;
}

describe("auxiliary tracks in score preview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const metrics = {
      measureText: (text: string) => ({
        width: text.length * 9,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(metrics as unknown as CanvasRenderingContext2D);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await loadVexFlow();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps docked and dialog controls, staff visibility and note selection in sync", async () => {
    const melody = addAuxiliaryTrack(createEmptyProject(), { name: "旋律", shortName: "Mel" });
    const melodyId = melody.trackId!;
    const bass = addAuxiliaryTrack(melody.project, { name: "参考低音", shortName: "Ref" });
    const bassId = bass.trackId!;
    let project = addTestNote(bass.project, melodyId, "chord-low", 60, 0, 960);
    project = addTestNote(project, melodyId, "chord-high", 64, 0, 960);
    project = addTestNote(project, bassId, "reference-low", 40, 0, 960);
    const onSelectNote = vi.fn();
    const noop = () => {};

    function Workspace() {
      const history = useProjectHistory(project);
      const [open, setOpen] = useState(false);
      const [selected, setSelected] = useState(new Set<string>());
      const actions = {
        onToggleAuxiliaryTrack: (trackId: string, showInScorePreview: boolean) => {
          history.commit(updateTrack(history.project, trackId, { showInScorePreview }).project);
        },
        onSetAllAuxiliaryTracks: (show: boolean) => {
          history.commit(setAuxiliaryTracksScorePreview(history.project, show));
        },
      };
      const preview = {
        project: history.project,
        revision: history.revision,
        playheadTick: 120,
        isPlaying: true,
        selectedNoteIds: selected,
        onSelectNote,
      };
      return (
        <>
          <button onClick={history.undo}>撤销</button>
          <button onClick={history.redo}>重做</button>
          <button onClick={() => setSelected(new Set(["chord-high"]))}>仅选中高音</button>
          <ScorePreviewToolbar
            {...actions}
            auxiliaryTracks={history.project.auxiliaryTracks}
            scale={1}
            canZoomIn={false}
            canZoomOut={false}
            onZoomIn={noop}
            onZoomOut={noop}
            followPlayhead={false}
            onFollowPlayheadChange={noop}
            highlightMode="color"
            onHighlightModeChange={noop}
            extra={<button onClick={() => setOpen(true)}>在独立大窗口中打开五线谱</button>}
          />
          <ScorePreviewPane {...preview} />
          {open && <ScorePreviewDialog {...preview} {...actions} onClose={() => setOpen(false)} />}
        </>
      );
    }

    const button = (name: string, scope: ParentNode = document) => {
      const match = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
      );
      expect(match, name).toBeDefined();
      return match!;
    };
    const click = (element: HTMLElement) => act(async () => element.click());
    const picker = () => document.querySelector('[aria-label="五线谱额外声部"]');
    const auxNote = (scope: ParentNode, id: string) =>
      scope.querySelector<SVGElement>(`.score-aux-note[data-source-note-id="${id}"]`);

    await act(async () => root.render(<Workspace />));
    expect(auxNote(host, "chord-low")).toBeNull();
    await click(button("额外声部 0/2", host));
    expect(picker()?.textContent).toContain("旋律2 个音符");
    await click(picker()!.querySelector<HTMLInputElement>("input")!);
    expect(auxNote(host, "chord-low")?.querySelectorAll(".vf-notehead")).toHaveLength(2);
    expect(auxNote(host, "chord-low")?.classList.contains("is-active")).toBe(true);
    const outside = button("在独立大窗口中打开五线谱", host);
    await act(async () => outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(picker()).toBeNull();

    await click(outside);
    const dialog = document.querySelector(".score-preview-dialog")!;
    expect(dialog.textContent).toContain("含 1 条额外声部");
    await click(button("额外声部 1/2", dialog));
    await click(button("全部显示", picker()!));
    expect(button("额外声部 2/2", host)).toBeDefined();
    expect(auxNote(host, "reference-low")).not.toBeNull();
    expect(auxNote(dialog, "reference-low")).not.toBeNull();

    const escape = () => act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    await escape();
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(button("额外声部 2/2", dialog));
    await escape();
    expect(document.querySelector(".score-preview-dialog")).toBeNull();

    await click(button("撤销", host));
    expect(button("额外声部 1/2", host)).toBeDefined();
    expect(auxNote(host, "reference-low")).toBeNull();
    await click(button("重做", host));
    expect(auxNote(host, "reference-low")).not.toBeNull();
    await click(button("仅选中高音", host));
    const chord = auxNote(host, "chord-low")!;
    expect(chord.classList.contains("is-selected")).toBe(true);
    await act(async () => chord.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectNote).toHaveBeenCalledWith({
      sourceNoteId: "chord-low", sourceNoteIds: ["chord-low", "chord-high"], voiceId: melodyId, tick: 0,
    });

    await click(button("额外声部 2/2", host));
    await click(button("全部隐藏", picker()!));
    expect(button("额外声部 0/2", host)).toBeDefined();
    expect(host.querySelector(".score-aux-note")).toBeNull();
    expect(host.textContent).toContain("已隐藏 2 条额外声部（3 个音符）");
    await click(button("撤销", host));
    expect(button("额外声部 2/2", host)).toBeDefined();
    expect(auxNote(host, "chord-low")).not.toBeNull();
    expect(auxNote(host, "reference-low")).not.toBeNull();
  });

  it.each([
    { width: 1000, tieCount: 1 },
    { width: 420, tieCount: 2 },
  ])("draws per-pitch ties at width $width even when chord indexes change", async ({ width, tieCount }) => {
    const added = addAuxiliaryTrack(createEmptyProject(), { showInScorePreview: true });
    const trackId = added.trackId!;
    let project = addTestNote(added.project, trackId, "held", 67, 2880, 1920);
    project = addTestNote(project, trackId, "upper", 72, 2880, 960);
    project = addTestNote(project, trackId, "lower", 60, 3840, 960);
    // Make the first measure too wide to share a system at the narrow viewport.
    project = addTestNote(project, trackId, "first", 60, 0, 960);
    project = addTestNote(project, trackId, "second", 61, 960, 960);
    project = addTestNote(project, trackId, "third", 62, 1920, 960);

    const renderHost = document.createElement("div");
    const result = renderScorePreview(renderHost, buildScorePreviewModel(project), {
      availableWidth: width,
    }, await loadVexFlow());
    expect(result.warnings).toEqual([]);
    const ties = renderHost.querySelectorAll(".vf-stavetie path");
    expect(ties).toHaveLength(tieCount);
    // Both ends lie at the same Y only when the rendered tie uses both correct pitch indexes.
    for (const tie of ties) {
      const coordinates = tie.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(coordinates[1]).toBe(coordinates[5]);
    }
    result.cleanup();
  });

  it("keeps auxiliary timing aligned through unsupported spans and tracks accidentals per staff", async () => {
    const melody = addAuxiliaryTrack(createEmptyProject(), { showInScorePreview: true });
    const reference = addAuxiliaryTrack(melody.project, { showInScorePreview: true });
    let project = addTestNote(reference.project, melody.trackId!, "off-grid", 60, 0, 61);
    project = addTestNote(project, melody.trackId!, "sharp-first", 66, 960, 1920);
    project = addTestNote(project, melody.trackId!, "sharp-overlap", 66, 1920, 960);
    project = addTestNote(project, reference.trackId!, "sharp-reference", 66, 1920, 960);
    project = addTestNote(project, "soprano", "aligned-satb", 72, 960, 960);

    const renderHost = document.createElement("div");
    const result = renderScorePreview(renderHost, buildScorePreviewModel(project), {}, await loadVexFlow());
    expect(result.warnings).toEqual([]);
    function headGlyphs(id: string) {
      return [...renderHost.querySelectorAll<SVGTextElement>(
        `.score-note[data-source-note-id="${id}"] .vf-notehead text`,
      )];
    }
    expect(headGlyphs("sharp-first")).toHaveLength(2);
    expect(headGlyphs("sharp-overlap")).toHaveLength(1);
    expect(headGlyphs("sharp-reference")).toHaveLength(2);
    expect(headGlyphs("sharp-first")[0].getAttribute("x"))
      .toBe(headGlyphs("aligned-satb")[0].getAttribute("x"));
    result.cleanup();
  });
});
