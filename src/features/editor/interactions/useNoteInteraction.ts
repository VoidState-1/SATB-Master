import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { HarmonyDiagnostic } from "../../../domain/harmony";
import {
  keyAtTick,
  snapTickBackward,
  snapTickForward,
} from "../../../domain/time";
import {
  VOICE_CONFIG,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../domain/project";
import {
  formatSpelledPitch,
  toMidi,
  transposeSpelledPitch,
} from "../../../domain/pitch";
import type { EditorDomain, EditorTool } from "../types";
import type { NoteInteraction, PointerInteraction } from "./types";
import {
  HEADER_HEIGHT,
  MAX_MIDI,
  MIN_MIDI,
  PIANO_WIDTH,
  ROW_HEIGHT,
  durationToWidth,
  midiToY,
  tickToX,
  xToTick,
  yToMidi,
} from "../viewport";
import type { NoteRect } from "../layers/types";

interface UseNoteInteractionProps {
  project: ProjectDocument;
  activeVoice: VoiceId;
  tool: EditorTool;
  gridTicks: number;
  pixelsPerBeat: number;
  selectedNoteIds: Set<string>;
  diagnosticsByNote: Map<string, HarmonyDiagnostic[]>;
  scrollRef: RefObject<HTMLDivElement | null>;
  cancelRequest: number;
  onSetPlayhead(tick: number): void;
  onSetEditorDomain(domain: EditorDomain): void;
  onSetActiveVoice(voiceId: VoiceId): void;
  onSelectNotes(noteIds: Set<string>): void;
  onSelectChords(chordIds: Set<string>): void;
  onPreviewNote(voiceId: VoiceId, midiNote: number): void;
  onAddNote(
    voiceId: VoiceId,
    tick: number,
    midiNote: number,
    durationTicks?: number,
  ): void;
  onUpdateNote(
    voiceId: VoiceId,
    noteId: string,
    patch: Partial<NoteEvent>,
  ): void;
  onMoveNotes(
    noteIds: Set<string>,
    tickDelta: number,
    pitchDelta: number,
  ): void;
  onDeleteNotes(noteIds: Set<string>): void;
  onSplitNote(voiceId: VoiceId, noteId: string, splitTick: number): void;
  showDiagnosticTooltip(
    event: React.PointerEvent,
    targetId: string,
    title: string,
    diagnostics: HarmonyDiagnostic[],
  ): void;
  clearDiagnosticTooltip(): void;
}

export function useNoteInteraction({
  project,
  activeVoice,
  tool,
  gridTicks,
  pixelsPerBeat,
  selectedNoteIds,
  diagnosticsByNote,
  scrollRef,
  cancelRequest,
  onSetPlayhead,
  onSetEditorDomain,
  onSetActiveVoice,
  onSelectNotes,
  onSelectChords,
  onPreviewNote,
  onAddNote,
  onUpdateNote,
  onMoveNotes,
  onDeleteNotes,
  onSplitNote,
  showDiagnosticTooltip,
  clearDiagnosticTooltip,
}: UseNoteInteractionProps) {
  const [interaction, setInteraction] = useState<PointerInteraction>();
  const noteRects = useMemo<NoteRect[]>(() => {
    const erasedNoteIds =
      interaction?.kind === "erase" ? interaction.noteIds : undefined;
    return project.satbTracks.flatMap((track) => {
      if (!track.visible) return [];
      return track.notes
        .filter((note) => !erasedNoteIds?.has(note.id))
        .map((note) => {
          const noteDrag =
            interaction?.kind === "move" || interaction?.kind === "resize"
              ? interaction
              : undefined;
          const isAnchor = noteDrag?.noteId === note.id;
          const isGroupMove =
            noteDrag?.kind === "move" && noteDrag.selectedIds.includes(note.id);
          const startTick = isAnchor
            ? noteDrag!.nextStartTick
            : isGroupMove
              ? note.startTick + noteDrag!.tickDelta
              : note.startTick;
          const durationTicks = isAnchor
            ? noteDrag!.nextDurationTicks
            : note.durationTicks;
          const baseMidiNote = toMidi(note.pitch);
          const midiNote = isAnchor
            ? noteDrag!.nextMidiNote
            : isGroupMove
              ? baseMidiNote + noteDrag!.pitchDelta
              : baseMidiNote;
          const displayPitch =
            midiNote === baseMidiNote
              ? note.pitch
              : transposeSpelledPitch(
                  note.pitch,
                  midiNote - baseMidiNote,
                  keyAtTick(project.keyEvents, startTick),
                );
          return {
            track,
            note,
            midiNote,
            label: formatSpelledPitch(displayPitch),
            x: tickToX(startTick, project.ppq, pixelsPerBeat),
            y: midiToY(midiNote) + 2,
            width: Math.max(
              5,
              durationToWidth(durationTicks, project.ppq, pixelsPerBeat, 1),
            ),
            height: ROW_HEIGHT - 4,
          };
        });
    });
  }, [interaction, pixelsPerBeat, project]);

  useEffect(() => {
    setInteraction(undefined);
  }, [cancelRequest]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hitTest = (x: number, y: number) =>
    [...noteRects]
      .reverse()
      .find(
        (rect) =>
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height,
      );
  const rawTickAtX = (x: number) =>
    xToTick(x, project.ppq, pixelsPerBeat, project.lengthTicks);
  const snapStartTick = (x: number) =>
    snapTickBackward(rawTickAtX(x), gridTicks, project.lengthTicks - gridTicks);
  const midiAtY = (y: number) => yToMidi(y);
  const focusEditor = () => {
    onSetEditorDomain("notes");
    scrollRef.current?.focus({ preventScroll: true });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    clearDiagnosticTooltip();
    focusEditor();
    if (event.button === 1) {
      const scroll = scrollRef.current;
      if (!scroll) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({
        kind: "pan",
        originClientX: event.clientX,
        originClientY: event.clientY,
        originScrollLeft: scroll.scrollLeft,
        originScrollTop: scroll.scrollTop,
      });
      return;
    }
    if (event.button !== 0) return;
    const point = localPoint(event);
    if (point.y < HEADER_HEIGHT || point.x < PIANO_WIDTH) return;
    const hit = hitTest(point.x, point.y);

    if (tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({
        kind: "erase",
        noteIds: new Set(hit ? [hit.note.id] : []),
      });
      return;
    }
    if (tool === "pencil") {
      const originRawTick = rawTickAtX(point.x);
      const originTick = snapTickBackward(
        originRawTick,
        gridTicks,
        project.lengthTicks - gridTicks,
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({
        kind: "draw",
        voiceId: activeVoice,
        midiNote: midiAtY(point.y),
        originRawTick,
        nextStartTick: originTick,
        nextDurationTicks: gridTicks,
      });
      return;
    }
    if (tool === "split") {
      if (hit) onSplitNote(hit.track.id, hit.note.id, snapStartTick(point.x));
      return;
    }

    if (!hit) {
      onSelectChords(new Set());
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({
        kind: "marquee",
        originX: point.x,
        originY: point.y,
        currentX: point.x,
        currentY: point.y,
        append: event.shiftKey,
      });
      return;
    }

    const nextSelection = selectedNoteIds.has(hit.note.id)
      ? new Set(selectedNoteIds)
      : event.shiftKey
        ? new Set(selectedNoteIds)
        : new Set<string>();
    if (event.shiftKey && nextSelection.has(hit.note.id))
      nextSelection.delete(hit.note.id);
    else nextSelection.add(hit.note.id);
    onSelectNotes(nextSelection);
    onSelectChords(new Set());
    if (!nextSelection.has(hit.note.id)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = point.x >= hit.x + hit.width - 7;
    setInteraction({
      kind: resize ? "resize" : "move",
      voiceId: hit.track.id,
      noteId: hit.note.id,
      selectedIds: resize ? [hit.note.id] : [...nextSelection],
      originX: point.x,
      originY: point.y,
      startTick: hit.note.startTick,
      durationTicks: hit.note.durationTicks,
      midiNote: toMidi(hit.note.pitch),
      tickDelta: 0,
      pitchDelta: 0,
      nextStartTick: hit.note.startTick,
      nextDurationTicks: hit.note.durationTicks,
      nextMidiNote: toMidi(hit.note.pitch),
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interaction) {
      const point = localPoint(event);
      const hit = hitTest(point.x, point.y);
      if (!hit) {
        clearDiagnosticTooltip();
        return;
      }
      showDiagnosticTooltip(
        event,
        `note:${hit.note.id}`,
        `${hit.label} · ${VOICE_CONFIG[hit.track.id].name}`,
        diagnosticsByNote.get(hit.note.id) ?? [],
      );
      return;
    }
    if (interaction.kind === "pan") {
      const scroll = scrollRef.current;
      if (scroll) {
        scroll.scrollLeft =
          interaction.originScrollLeft -
          (event.clientX - interaction.originClientX);
        scroll.scrollTop =
          interaction.originScrollTop -
          (event.clientY - interaction.originClientY);
      }
      return;
    }
    const point = localPoint(event);
    if (interaction.kind === "marquee") {
      setInteraction({ ...interaction, currentX: point.x, currentY: point.y });
      return;
    }
    if (interaction.kind === "draw") {
      const currentRawTick = rawTickAtX(point.x);
      // 拖绘跨过的原始区间两端分别向外吸附，避免右边界也向前取整而多拖一格。
      const nextStartTick = snapTickBackward(
        Math.min(interaction.originRawTick, currentRawTick),
        gridTicks,
        project.lengthTicks - gridTicks,
      );
      const nextEndTick = Math.max(
        nextStartTick + gridTicks,
        snapTickForward(
          Math.max(interaction.originRawTick, currentRawTick),
          gridTicks,
          project.lengthTicks,
        ),
      );
      setInteraction({
        ...interaction,
        nextStartTick,
        nextDurationTicks: Math.max(gridTicks, nextEndTick - nextStartTick),
      });
      return;
    }
    if (interaction.kind === "erase") {
      const hit = hitTest(point.x, point.y);
      if (hit && !interaction.noteIds.has(hit.note.id)) {
        const noteIds = new Set(interaction.noteIds);
        noteIds.add(hit.note.id);
        setInteraction({ ...interaction, noteIds });
      }
      return;
    }

    const requestedTickDelta =
      Math.round(
        (((point.x - interaction.originX) / pixelsPerBeat) * project.ppq) /
          gridTicks,
      ) * gridTicks;
    const requestedPitchDelta = -Math.round(
      (point.y - interaction.originY) / ROW_HEIGHT,
    );
    if (interaction.kind === "resize") {
      // 缩放使用绝对结束位置向后吸附；鼠标一旦进入下一格，时值立即延长到该格末端。
      const requestedEndTick = snapTickForward(
        rawTickAtX(point.x),
        gridTicks,
        project.lengthTicks,
      );
      const maxDuration = project.lengthTicks - interaction.startTick;
      const duration = Math.max(
        Math.min(gridTicks, maxDuration),
        Math.min(maxDuration, requestedEndTick - interaction.startTick),
      );
      setInteraction({
        ...interaction,
        tickDelta: duration - interaction.durationTicks,
        nextDurationTicks: duration,
      });
    } else {
      const selectedRects = noteRects.filter((rect) =>
        interaction.selectedIds.includes(rect.note.id),
      );
      const minStart = Math.min(
        ...selectedRects.map((rect) => rect.note.startTick),
      );
      const maxEnd = Math.max(
        ...selectedRects.map(
          (rect) => rect.note.startTick + rect.note.durationTicks,
        ),
      );
      const minPitch = Math.min(...selectedRects.map((rect) => rect.midiNote));
      const maxPitch = Math.max(...selectedRects.map((rect) => rect.midiNote));
      const tickDelta = Math.max(
        -minStart,
        Math.min(project.lengthTicks - maxEnd, requestedTickDelta),
      );
      const pitchDelta = Math.max(
        MIN_MIDI - minPitch,
        Math.min(MAX_MIDI - maxPitch, requestedPitchDelta),
      );
      if (
        interaction.selectedIds.length === 1 &&
        pitchDelta !== interaction.pitchDelta
      ) {
        onPreviewNote(interaction.voiceId, interaction.midiNote + pitchDelta);
      }
      setInteraction({
        ...interaction,
        tickDelta,
        pitchDelta,
        nextStartTick: interaction.startTick + tickDelta,
        nextMidiNote: interaction.midiNote + pitchDelta,
      });
    }
  };

  const finishInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interaction) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction.kind === "pan") {
      setInteraction(undefined);
      return;
    } else if (
      interaction.kind === "resize" &&
      interaction.nextDurationTicks !== interaction.durationTicks
    ) {
      onUpdateNote(interaction.voiceId, interaction.noteId, {
        durationTicks: interaction.nextDurationTicks,
      });
    } else if (
      interaction.kind === "move" &&
      (interaction.tickDelta !== 0 || interaction.pitchDelta !== 0)
    ) {
      onMoveNotes(
        new Set(interaction.selectedIds),
        interaction.tickDelta,
        interaction.pitchDelta,
      );
    } else if (interaction.kind === "draw") {
      onAddNote(
        interaction.voiceId,
        interaction.nextStartTick,
        interaction.midiNote,
        interaction.nextDurationTicks,
      );
    } else if (interaction.kind === "erase" && interaction.noteIds.size > 0) {
      onDeleteNotes(interaction.noteIds);
    } else if (interaction.kind === "marquee") {
      const left = Math.min(interaction.originX, interaction.currentX);
      const right = Math.max(interaction.originX, interaction.currentX);
      const top = Math.min(interaction.originY, interaction.currentY);
      const bottom = Math.max(interaction.originY, interaction.currentY);
      const selected = interaction.append
        ? new Set(selectedNoteIds)
        : new Set<string>();
      if (right - left < 4 && bottom - top < 4) {
        onSetPlayhead(snapStartTick(interaction.originX));
      } else {
        noteRects.forEach((rect) => {
          if (
            rect.x < right &&
            rect.x + rect.width > left &&
            rect.y < bottom &&
            rect.y + rect.height > top
          )
            selected.add(rect.note.id);
        });
      }
      onSelectNotes(selected);
    }
    setInteraction(undefined);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "select") return;
    focusEditor();
    const rect = event.currentTarget.getBoundingClientRect();
    const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (hit && hit.track.id !== activeVoice) {
      onSetActiveVoice(hit.track.id);
    }
  };

  return {
    interaction,
    noteRects,
    handlePointerDown,
    handlePointerMove,
    finishInteraction,
    cancelInteraction: () => setInteraction(undefined),
    handleDoubleClick,
  };
}
