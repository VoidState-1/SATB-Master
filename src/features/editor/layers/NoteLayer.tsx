import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { HarmonyDiagnostic } from "../../../domain/harmony";
import { keyAtTick, type MeasureInfo } from "../../../domain/time";
import { VOICE_CONFIG, type ProjectDocument, type VoiceId } from "../../../domain/model";
import { formatSpelledPitch, spellMidi } from "../../../domain/pitch";
import { isBlackKey, primaryDiagnostic } from "../geometry";
import type { PointerInteraction } from "../interactions/types";
import type { EditorTool } from "../types";
import {
  HEADER_HEIGHT,
  MAX_MIDI,
  MIN_MIDI,
  PIANO_WIDTH,
  ROW_HEIGHT,
  durationToWidth,
  midiToY,
  tickToX,
} from "../viewport";
import type { NoteRect } from "./types";

interface NoteLayerProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  project: ProjectDocument;
  measures: MeasureInfo[];
  pixelsPerBeat: number;
  rollHeight: number;
  totalWidth: number;
  totalHeight: number;
  activeVoice: VoiceId;
  selectedNoteIds: Set<string>;
  diagnosticsByNote: Map<string, HarmonyDiagnostic[]>;
  interaction?: PointerInteraction;
  noteRects: NoteRect[];
  tool: EditorTool;
  onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>): void;
}

export function NoteLayer({
  scrollRef,
  project,
  measures,
  pixelsPerBeat,
  rollHeight,
  totalWidth,
  totalHeight,
  activeVoice,
  selectedNoteIds,
  diagnosticsByNote,
  interaction,
  noteRects,
  tool,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onDoubleClick,
}: NoteLayerProps) {
  const viewportCanvasRef = useRef<HTMLCanvasElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const updateViewportSize = () => {
      const next = {
        width: Math.max(1, scroll.clientWidth),
        height: Math.max(1, scroll.clientHeight),
      };
      setViewportSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    const canvas = viewportCanvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;
    const ratio = window.devicePixelRatio || 1;
    const renderWidth = viewportSize.width;
    const renderHeight = viewportSize.height;
    const pixelWidth = Math.ceil(renderWidth * ratio);
    const pixelHeight = Math.ceil(renderHeight * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;
    const context = canvas.getContext("2d");
    if (!context) return;

    // 工程可以很长，但位图只覆盖当前视口，避免缩放后分配数万像素宽的 Canvas。
    const drawViewport = () => {
      const visibleLeft = scroll.scrollLeft;
      const visibleTop = scroll.scrollTop;
      const visibleRight = visibleLeft + renderWidth;
      const visibleBottom = visibleTop + renderHeight;
      canvas.style.transform = `translate3d(${visibleLeft}px, ${visibleTop}px, 0)`;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.setTransform(
        ratio,
        0,
        0,
        ratio,
        -visibleLeft * ratio,
        -visibleTop * ratio,
      );
      context.save();
      context.beginPath();
      context.rect(visibleLeft, visibleTop, renderWidth, renderHeight);
      context.clip();

      context.fillStyle = "#f7f7f3";
      context.fillRect(visibleLeft, visibleTop, renderWidth, renderHeight);
      for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi -= 1) {
        const y = midiToY(midi);
        if (y > visibleBottom || y + ROW_HEIGHT < visibleTop) continue;
        const rowLeft = Math.max(PIANO_WIDTH, visibleLeft);
        if (isBlackKey(midi)) {
          context.fillStyle = "#eeeee9";
          context.fillRect(rowLeft, y, visibleRight - rowLeft, ROW_HEIGHT);
        }
        context.strokeStyle = midi % 12 === 0 ? "#c4c5be" : "#dedfd9";
        context.lineWidth = midi % 12 === 0 ? 1.2 : 1;
        context.beginPath();
        context.moveTo(rowLeft, y + ROW_HEIGHT);
        context.lineTo(visibleRight, y + ROW_HEIGHT);
        context.stroke();
      }

      measures.forEach((measure) => {
        const measureLeft = tickToX(
          measure.startTick,
          project.ppq,
          pixelsPerBeat,
        );
        const measureRight = tickToX(
          measure.endTick,
          project.ppq,
          pixelsPerBeat,
        );
        if (measureRight < visibleLeft || measureLeft > visibleRight) return;
        measure.beatTicks.forEach((tick, beatIndex) => {
          const x = tickToX(tick, project.ppq, pixelsPerBeat);
          if (x >= visibleLeft - 1 && x <= visibleRight + 1) {
            context.strokeStyle = beatIndex === 0 ? "#aeb0a8" : "#d6d7d1";
            context.lineWidth = beatIndex === 0 ? 1.25 : 1;
            context.beginPath();
            context.moveTo(x, Math.max(HEADER_HEIGHT, visibleTop));
            context.lineTo(x, visibleBottom);
            context.stroke();
          }

          for (let subdivision = 1; subdivision < 4; subdivision += 1) {
            const subTick =
              tick +
              ((project.ppq * 4) / measure.denominator) * (subdivision / 4);
            if (subTick >= measure.endTick) continue;
            const subX = tickToX(subTick, project.ppq, pixelsPerBeat);
            if (subX < visibleLeft - 1 || subX > visibleRight + 1) continue;
            context.strokeStyle = "#e8e8e3";
            context.beginPath();
            context.moveTo(subX, Math.max(HEADER_HEIGHT, visibleTop));
            context.lineTo(subX, visibleBottom);
            context.stroke();
          }
        });
      });

      // 共享卷帘无法按声部分栏着色，因此用轻量时间带提示锁定区间，并在顶部标明受限声部。
      project.exercise.editableRanges
        .filter((range) => !range.editable)
        .forEach((range) => {
          const x = tickToX(range.fromTick, project.ppq, pixelsPerBeat);
          const width = durationToWidth(
            range.toTick - range.fromTick,
            project.ppq,
            pixelsPerBeat,
          );
          if (x > visibleRight || x + width < visibleLeft) return;
          context.fillStyle = "rgba(52, 57, 50, 0.055)";
          context.fillRect(x, HEADER_HEIGHT, width, rollHeight);
          context.save();
          context.setLineDash([4, 3]);
          context.strokeStyle = "rgba(52, 57, 50, 0.38)";
          context.strokeRect(
            x + 0.5,
            HEADER_HEIGHT + 0.5,
            Math.max(0, width - 1),
            rollHeight - 1,
          );
          context.restore();
          context.fillStyle = "rgba(52, 57, 50, 0.7)";
          context.font = "10px Segoe UI";
          context.fillText(
            `锁定 ${range.voiceIds.map((voiceId) => VOICE_CONFIG[voiceId].shortName).join("/")}`,
            x + 5,
            HEADER_HEIGHT + 13,
          );
        });

      noteRects.forEach(({ track, note, label, x, y, width, height }) => {
        if (
          x > visibleRight ||
          x + width < visibleLeft ||
          y > visibleBottom ||
          y + height < visibleTop
        )
          return;
        const config = VOICE_CONFIG[track.id];
        context.fillStyle =
          track.id === activeVoice ? config.color : `${config.color}b8`;
        context.beginPath();
        context.roundRect(x, y, width, height, 3);
        context.fill();

        if (selectedNoteIds.has(note.id)) {
          context.strokeStyle = "#171914";
          context.lineWidth = 2;
          context.stroke();
        }
        const issue = primaryDiagnostic(diagnosticsByNote.get(note.id) ?? []);
        if (issue) {
          context.fillStyle =
            issue.severity === "error"
              ? "#c93f34"
              : issue.severity === "warning"
                ? "#d49324"
                : "#4d7469";
          context.fillRect(x, y + height - 3, width, 3);
        }
        if (width > 25) {
          context.fillStyle = "#fff";
          context.font = "600 10px Segoe UI";
          context.fillText(label, x + 5, y + 12);
        }
        if ((note.locked || track.locked) && width > 48) {
          context.fillStyle = "rgba(255,255,255,.72)";
          context.font = "10px Segoe UI";
          context.fillText("锁", x + width - 15, y + 12);
        }
      });

      if (interaction?.kind === "draw") {
        const x = tickToX(
          interaction.nextStartTick,
          project.ppq,
          pixelsPerBeat,
        );
        const y = midiToY(interaction.midiNote) + 2;
        const width = Math.max(
          5,
          durationToWidth(
            interaction.nextDurationTicks,
            project.ppq,
            pixelsPerBeat,
            1,
          ),
        );
        context.fillStyle = `${VOICE_CONFIG[interaction.voiceId].color}70`;
        context.fillRect(x, y, width, ROW_HEIGHT - 4);
        context.strokeStyle = VOICE_CONFIG[interaction.voiceId].darkColor;
        context.strokeRect(x + 0.5, y + 0.5, width - 1, ROW_HEIGHT - 5);
        if (width > 25) {
          context.fillStyle = "#fff";
          context.font = "600 10px Segoe UI";
          context.fillText(
            formatSpelledPitch(
              spellMidi(
                interaction.midiNote,
                keyAtTick(project.keyEvents, interaction.nextStartTick),
              ),
            ),
            x + 5,
            y + 12,
          );
        }
      }

      if (interaction?.kind === "marquee") {
        const left = Math.min(interaction.originX, interaction.currentX);
        const top = Math.min(interaction.originY, interaction.currentY);
        const width = Math.abs(interaction.currentX - interaction.originX);
        const height = Math.abs(interaction.currentY - interaction.originY);
        context.fillStyle = "rgba(47, 119, 100, 0.11)";
        context.fillRect(left, top, width, height);
        context.save();
        context.setLineDash([4, 3]);
        context.strokeStyle = "#2f7764";
        context.strokeRect(left + 0.5, top + 0.5, width, height);
        context.restore();
      }

      context.restore();
    };

    drawViewport();
    let frameId: number | undefined;
    const handleViewportScroll = () => {
      if (frameId !== undefined) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = undefined;
        drawViewport();
      });
    };
    scroll.addEventListener("scroll", handleViewportScroll, { passive: true });
    return () => {
      scroll.removeEventListener("scroll", handleViewportScroll);
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, [
    activeVoice,
    diagnosticsByNote,
    interaction,
    measures,
    noteRects,
    pixelsPerBeat,
    project,
    rollHeight,
    scrollRef,
    selectedNoteIds,
    viewportSize,
  ]);

  return (
    <>
      <canvas
        ref={viewportCanvasRef}
        className="roll-viewport-canvas"
        aria-hidden="true"
      />
      <canvas
        className={`roll-canvas tool-${tool} ${interaction?.kind === "pan" ? "is-panning" : ""}`}
        width={1}
        height={1}
        style={{ width: totalWidth, height: totalHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onAuxClick={(event) => event.preventDefault()}
      />
    </>
  );
}
