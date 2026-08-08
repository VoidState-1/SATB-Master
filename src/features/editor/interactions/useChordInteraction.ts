import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { ChordRegionPatch } from "../../../domain/editing";
import type { ChordRegion, ProjectDocument } from "../../../domain/project";
import { snapTickBackward, snapTickForward } from "../../../domain/time";
import type { EditorDomain, EditorTool } from "../types";
import type { ChordInteraction } from "./types";
import { durationToWidth, tickToX, xToTick } from "../viewport";
import type { ChordRect } from "../layers/types";

interface UseChordInteractionProps {
  project: ProjectDocument;
  tool: EditorTool;
  gridTicks: number;
  pixelsPerBeat: number;
  selectedChordIds: Set<string>;
  scrollRef: RefObject<HTMLDivElement | null>;
  cancelRequest: number;
  onSetPlayhead(tick: number): void;
  onSetEditorDomain(domain: EditorDomain): void;
  onSelectChords(chordIds: Set<string>): void;
  onSelectNotes(noteIds: Set<string>): void;
  onAddChord(tick: number, durationTicks: number): string | undefined;
  onUpdateChord(chordId: string, patch: ChordRegionPatch): void;
  onMoveChords(chordIds: Set<string>, tickDelta: number): void;
  onDeleteChords(chordIds: Set<string>): void;
  onSplitChord(chordId: string, splitTick: number): void;
  onOpenChordPalette(chordId: string, anchor: { x: number; y: number }): void;
  clearDiagnosticTooltip(): void;
}

export function useChordInteraction({
  project,
  tool,
  gridTicks,
  pixelsPerBeat,
  selectedChordIds,
  scrollRef,
  cancelRequest,
  onSetPlayhead,
  onSetEditorDomain,
  onSelectChords,
  onSelectNotes,
  onAddChord,
  onUpdateChord,
  onMoveChords,
  onDeleteChords,
  onSplitChord,
  onOpenChordPalette,
  clearDiagnosticTooltip,
}: UseChordInteractionProps) {
  const [chordInteraction, setChordInteraction] =
    useState<ChordInteraction>();

  useEffect(() => {
    setChordInteraction(undefined);
  }, [cancelRequest]);

  const rawTickAtX = (x: number) =>
    xToTick(x, project.ppq, pixelsPerBeat, project.lengthTicks);
  const snapStartTick = (x: number) =>
    snapTickBackward(rawTickAtX(x), gridTicks, project.lengthTicks - gridTicks);
  const keyBoundsAtTick = (tick: number) => {
    let startTick = 0;
    let endTick = project.lengthTicks;
    for (const event of project.keyEvents) {
      if (event.tick <= tick) startTick = event.tick;
      else {
        endTick = event.tick;
        break;
      }
    }
    return { startTick, endTick };
  };
  const chordAtX = (x: number) => {
    if (!project.chordTrack.visible) return undefined;
    const tick = rawTickAtX(x);
    return [...project.chordTrack.regions]
      .reverse()
      .find(
        (region) =>
          region.startTick <= tick &&
          region.startTick + region.durationTicks > tick,
      );
  };
  const chordSlotAtTick = (tick: number) => {
    const keyBounds = keyBoundsAtTick(tick);
    let startTick = keyBounds.startTick;
    let endTick = keyBounds.endTick;
    project.chordTrack.regions.forEach((region) => {
      const regionEnd = region.startTick + region.durationTicks;
      if (regionEnd <= tick) startTick = Math.max(startTick, regionEnd);
      if (region.startTick > tick)
        endTick = Math.min(endTick, region.startTick);
    });
    return { startTick, endTick };
  };
  const chordMoveBounds = (ids: Set<string>) => {
    let minimum = Number.NEGATIVE_INFINITY;
    let maximum = Number.POSITIVE_INFINITY;
    const fixed = project.chordTrack.regions.filter(
      (region) => !ids.has(region.id),
    );
    project.chordTrack.regions
      .filter((region) => ids.has(region.id))
      .forEach((region) => {
        const endTick = region.startTick + region.durationTicks;
        const keyBounds = keyBoundsAtTick(region.startTick);
        let leftBoundary = keyBounds.startTick;
        let rightBoundary = keyBounds.endTick;
        fixed.forEach((candidate) => {
          const candidateEnd = candidate.startTick + candidate.durationTicks;
          if (candidateEnd <= region.startTick)
            leftBoundary = Math.max(leftBoundary, candidateEnd);
          if (candidate.startTick >= endTick)
            rightBoundary = Math.min(rightBoundary, candidate.startTick);
        });
        minimum = Math.max(minimum, leftBoundary - region.startTick);
        maximum = Math.min(maximum, rightBoundary - endTick);
      });
    return {
      minimum: Number.isFinite(minimum) ? minimum : 0,
      maximum: Number.isFinite(maximum) ? maximum : 0,
    };
  };

  const chordRects = useMemo<ChordRect[]>(
    () =>
      (project.chordTrack.visible ? project.chordTrack.regions : [])
        .filter(
          (region) =>
            chordInteraction?.kind !== "erase" ||
            !chordInteraction.chordIds.has(region.id),
        )
        .map((region) => {
          const moving =
            chordInteraction?.kind === "move" &&
            chordInteraction.selectedIds.includes(region.id);
          const resizing =
            (chordInteraction?.kind === "resize-left" ||
              chordInteraction?.kind === "resize-right") &&
            chordInteraction.chordId === region.id;
          const startTick = moving
            ? region.startTick + chordInteraction.tickDelta
            : resizing
              ? chordInteraction.nextStartTick
              : region.startTick;
          const durationTicks = resizing
            ? chordInteraction.nextDurationTicks
            : region.durationTicks;
          return {
            region,
            startTick,
            durationTicks,
            x: tickToX(startTick, project.ppq, pixelsPerBeat),
            width: Math.max(
              5,
              durationToWidth(durationTicks, project.ppq, pixelsPerBeat, 2),
            ),
          };
        }),
    [chordInteraction, pixelsPerBeat, project],
  );

  const chordPointX = (event: React.PointerEvent<HTMLDivElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const focusEditor = () => {
    onSetEditorDomain("chords");
    scrollRef.current?.focus({ preventScroll: true });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    clearDiagnosticTooltip();
    focusEditor();
    if (event.button === 1) {
      const scroll = scrollRef.current;
      if (!scroll) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setChordInteraction({
        kind: "pan",
        originClientX: event.clientX,
        originClientY: event.clientY,
        originScrollLeft: scroll.scrollLeft,
        originScrollTop: scroll.scrollTop,
      });
      return;
    }
    if (event.button !== 0) return;
    const x = chordPointX(event);
    const hit = chordAtX(x);

    if (tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setChordInteraction({
        kind: "erase",
        chordIds: new Set(
          hit && !hit.locked && !project.chordTrack.locked ? [hit.id] : [],
        ),
      });
      return;
    }
    if (tool === "pencil") {
      if (hit || project.chordTrack.locked) return;
      const originRawTick = rawTickAtX(x);
      const slot = chordSlotAtTick(originRawTick);
      const startTick = Math.max(
        slot.startTick,
        snapTickBackward(
          originRawTick,
          gridTicks,
          project.lengthTicks - gridTicks,
        ),
      );
      const endTick = Math.min(slot.endTick, startTick + gridTicks);
      if (endTick <= startTick) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setChordInteraction({
        kind: "draw",
        originRawTick,
        nextStartTick: startTick,
        nextDurationTicks: endTick - startTick,
      });
      return;
    }
    if (tool === "split") {
      if (hit) onSplitChord(hit.id, snapStartTick(x));
      return;
    }
    if (!hit) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setChordInteraction({
        kind: "marquee",
        originX: x,
        currentX: x,
        append: event.shiftKey,
      });
      return;
    }

    const nextSelection = selectedChordIds.has(hit.id)
      ? new Set(selectedChordIds)
      : event.shiftKey
        ? new Set(selectedChordIds)
        : new Set<string>();
    if (event.shiftKey && nextSelection.has(hit.id))
      nextSelection.delete(hit.id);
    else nextSelection.add(hit.id);
    onSelectChords(nextSelection);
    onSetPlayhead(hit.startTick);
    if (!nextSelection.has(hit.id) || hit.locked || project.chordTrack.locked)
      return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = chordRects.find((candidate) => candidate.region.id === hit.id);
    const nearLeft = nextSelection.size === 1 && rect && x <= rect.x + 7;
    const nearRight =
      nextSelection.size === 1 && rect && x >= rect.x + rect.width - 7;
    if (nearLeft || nearRight) {
      setChordInteraction({
        kind: nearLeft ? "resize-left" : "resize-right",
        chordId: hit.id,
        originStartTick: hit.startTick,
        originDurationTicks: hit.durationTicks,
        nextStartTick: hit.startTick,
        nextDurationTicks: hit.durationTicks,
      });
    } else {
      setChordInteraction({
        kind: "move",
        chordId: hit.id,
        selectedIds: [...nextSelection],
        originX: x,
        tickDelta: 0,
      });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!chordInteraction) return;
    if (chordInteraction.kind === "pan") {
      const scroll = scrollRef.current;
      if (scroll) {
        scroll.scrollLeft =
          chordInteraction.originScrollLeft -
          (event.clientX - chordInteraction.originClientX);
        scroll.scrollTop =
          chordInteraction.originScrollTop -
          (event.clientY - chordInteraction.originClientY);
      }
      return;
    }
    const x = chordPointX(event);
    if (chordInteraction.kind === "erase") {
      const hit = chordAtX(x);
      if (
        hit &&
        !hit.locked &&
        !project.chordTrack.locked &&
        !chordInteraction.chordIds.has(hit.id)
      ) {
        const chordIds = new Set(chordInteraction.chordIds);
        chordIds.add(hit.id);
        setChordInteraction({ ...chordInteraction, chordIds });
      }
      return;
    }
    if (chordInteraction.kind === "marquee") {
      setChordInteraction({ ...chordInteraction, currentX: x });
      return;
    }
    if (chordInteraction.kind === "draw") {
      const currentRawTick = rawTickAtX(x);
      const slot = chordSlotAtTick(chordInteraction.originRawTick);
      const startTick = Math.max(
        slot.startTick,
        snapTickBackward(
          Math.min(chordInteraction.originRawTick, currentRawTick),
          gridTicks,
          project.lengthTicks - gridTicks,
        ),
      );
      const endTick = Math.min(
        slot.endTick,
        Math.max(
          startTick + gridTicks,
          snapTickForward(
            Math.max(chordInteraction.originRawTick, currentRawTick),
            gridTicks,
            project.lengthTicks,
          ),
        ),
      );
      setChordInteraction({
        ...chordInteraction,
        nextStartTick: startTick,
        nextDurationTicks: Math.max(0, endTick - startTick),
      });
      return;
    }
    if (chordInteraction.kind === "move") {
      const requested =
        Math.round(
          (((x - chordInteraction.originX) / pixelsPerBeat) * project.ppq) /
            gridTicks,
        ) * gridTicks;
      const bounds = chordMoveBounds(new Set(chordInteraction.selectedIds));
      setChordInteraction({
        ...chordInteraction,
        tickDelta: Math.max(
          bounds.minimum,
          Math.min(bounds.maximum, requested),
        ),
      });
      return;
    }

    const region = project.chordTrack.regions.find(
      (candidate) => candidate.id === chordInteraction.chordId,
    );
    if (!region) return;
    const keyBounds = keyBoundsAtTick(region.startTick);
    const previous = [...project.chordTrack.regions]
      .filter(
        (candidate) =>
          candidate.id !== region.id &&
          candidate.startTick + candidate.durationTicks <= region.startTick,
      )
      .at(-1);
    const next = project.chordTrack.regions.find(
      (candidate) =>
        candidate.id !== region.id &&
        candidate.startTick >= region.startTick + region.durationTicks,
    );
    const originalEnd = region.startTick + region.durationTicks;
    if (chordInteraction.kind === "resize-left") {
      const minimum = Math.max(
        keyBounds.startTick,
        previous ? previous.startTick + previous.durationTicks : 0,
      );
      const maximum = originalEnd - gridTicks;
      const startTick = Math.max(
        minimum,
        Math.min(maximum, snapTickBackward(rawTickAtX(x), gridTicks, maximum)),
      );
      setChordInteraction({
        ...chordInteraction,
        nextStartTick: startTick,
        nextDurationTicks: originalEnd - startTick,
      });
    } else {
      const maximum = Math.min(
        keyBounds.endTick,
        next?.startTick ?? project.lengthTicks,
      );
      const endTick = Math.max(
        region.startTick + gridTicks,
        Math.min(maximum, snapTickForward(rawTickAtX(x), gridTicks, maximum)),
      );
      setChordInteraction({
        ...chordInteraction,
        nextStartTick: region.startTick,
        nextDurationTicks: endTick - region.startTick,
      });
    }
  };

  const finishInteraction = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!chordInteraction) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      chordInteraction.kind === "draw" &&
      chordInteraction.nextDurationTicks > 0
    ) {
      const chordId = onAddChord(
        chordInteraction.nextStartTick,
        chordInteraction.nextDurationTicks,
      );
      if (chordId) {
        const laneRect = event.currentTarget.getBoundingClientRect();
        onOpenChordPalette(chordId, {
          x: event.clientX - 18,
          y: laneRect.bottom,
        });
      }
    } else if (
      chordInteraction.kind === "erase" &&
      chordInteraction.chordIds.size > 0
    ) {
      onDeleteChords(chordInteraction.chordIds);
    } else if (
      chordInteraction.kind === "move" &&
      chordInteraction.tickDelta !== 0
    ) {
      onMoveChords(
        new Set(chordInteraction.selectedIds),
        chordInteraction.tickDelta,
      );
    } else if (
      (chordInteraction.kind === "resize-left" ||
        chordInteraction.kind === "resize-right") &&
      (chordInteraction.nextStartTick !== chordInteraction.originStartTick ||
        chordInteraction.nextDurationTicks !==
          chordInteraction.originDurationTicks)
    ) {
      onUpdateChord(chordInteraction.chordId, {
        startTick: chordInteraction.nextStartTick,
        durationTicks: chordInteraction.nextDurationTicks,
      });
    } else if (chordInteraction.kind === "marquee") {
      const left = Math.min(
        chordInteraction.originX,
        chordInteraction.currentX,
      );
      const right = Math.max(
        chordInteraction.originX,
        chordInteraction.currentX,
      );
      const selected = chordInteraction.append
        ? new Set(selectedChordIds)
        : new Set<string>();
      if (right - left < 4) {
        onSetPlayhead(snapStartTick(chordInteraction.originX));
      } else {
        chordRects.forEach((rect) => {
          if (rect.x < right && rect.x + rect.width > left)
            selected.add(rect.region.id);
        });
      }
      onSelectChords(selected);
    }
    setChordInteraction(undefined);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "select" && tool !== "pencil") return;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const chord = chordAtX(x);
    if (!chord || chord.locked || project.chordTrack.locked) return;
    event.preventDefault();
    onSelectChords(new Set([chord.id]));
    onSelectNotes(new Set());
    onSetPlayhead(chord.startTick);
    const laneRect = event.currentTarget.getBoundingClientRect();
    onOpenChordPalette(chord.id, {
      x: event.clientX - 18,
      y: laneRect.bottom,
    });
  };

  return {
    chordInteraction,
    chordRects,
    handlePointerDown,
    handlePointerMove,
    finishInteraction,
    cancelInteraction: () => setChordInteraction(undefined),
    handleDoubleClick,
  };
}
