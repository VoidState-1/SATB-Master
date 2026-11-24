import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { THEME_CHANGE_EVENT } from "../../../hooks/useTheme";
import type { HarmonyDiagnostic } from "../../../domain/harmony";
import { keyAtTick, type MeasureInfo } from "../../../domain/time";
import {
  VOICE_CONFIG,
  type KeyEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../domain/project";
import { formatSpelledPitch, isDiatonicPitch, spellMidi, toMidi } from "../../../domain/pitch";
import { isBlackKey, primaryDiagnostic } from "../geometry";
import type { PointerInteraction } from "../interactions/types";
import type { EditorTool, ProgressionPreview } from "../types";
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
  viewportSize: { width: number; height: number };
  project: ProjectDocument;
  measures: MeasureInfo[];
  pixelsPerBeat: number;
  rollHeight: number;
  totalWidth: number;
  totalHeight: number;
  activeVoice: VoiceId;
  selectedNoteIds: Set<string>;
  diagnosticsByNote: Map<string, HarmonyDiagnostic[]>;
  missingExpectedNoteIds?: ReadonlySet<string>;
  interaction?: PointerInteraction;
  noteRects: NoteRect[];
  progressionPreview?: ProgressionPreview;
  tool: EditorTool;
  scaleGuideEnabled?: boolean;
  onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLCanvasElement>): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>): void;
}

function readRollCanvasTheme() {
  const fallback = {
    bg: "#f7f7f3",
    rowAlt: "#eeeee9",
    lineOctave: "#c4c5be",
    lineRow: "#dedfd9",
    lineMeasure: "#aeb0a8",
    lineBeat: "#d6d7d1",
    lineSub: "#e8e8e3",
    lockFill: "rgba(52, 57, 50, 0.055)",
    lockStroke: "rgba(52, 57, 50, 0.38)",
    lockText: "rgba(52, 57, 50, 0.72)",
    selectStroke: "#171914",
    marqueeFill: "rgba(39, 109, 89, 0.12)",
    marqueeStroke: "#276d59",
    danger: "#c03c32",
    warning: "#b06f10",
    suggestion: "#276d59",
    voices: {
      soprano: VOICE_CONFIG.soprano.color,
      alto: VOICE_CONFIG.alto.color,
      tenor: VOICE_CONFIG.tenor.color,
      bass: VOICE_CONFIG.bass.color,
    } as Record<VoiceId, string>,
  };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const style = window.getComputedStyle(document.documentElement);
  const read = (name: string, fb: string) => style.getPropertyValue(name).trim() || fb;
  return {
    bg: read("--roll-bg", fallback.bg),
    rowAlt: read("--roll-row-alt", fallback.rowAlt),
    lineOctave: read("--roll-line-octave", fallback.lineOctave),
    lineRow: read("--roll-line-row", fallback.lineRow),
    lineMeasure: read("--roll-line-measure", fallback.lineMeasure),
    lineBeat: read("--roll-line-beat", fallback.lineBeat),
    lineSub: read("--roll-line-sub", fallback.lineSub),
    lockFill: read("--roll-lock-fill", fallback.lockFill),
    lockStroke: read("--roll-lock-stroke", fallback.lockStroke),
    lockText: read("--roll-lock-text", fallback.lockText),
    selectStroke: read("--roll-select-stroke", fallback.selectStroke),
    marqueeFill: read("--roll-marquee-fill", fallback.marqueeFill),
    marqueeStroke: read("--roll-marquee-stroke", fallback.marqueeStroke),
    danger: read("--danger", fallback.danger),
    warning: read("--warning", fallback.warning),
    suggestion: read("--accent", fallback.suggestion),
    voices: {
      soprano: read("--voice-s", fallback.voices.soprano),
      alto: read("--voice-a", fallback.voices.alto),
      tenor: read("--voice-t", fallback.voices.tenor),
      bass: read("--voice-b", fallback.voices.bass),
    } as Record<VoiceId, string>,
  };
}

export function NoteLayer({
  scrollRef,
  viewportSize,
  project,
  measures,
  pixelsPerBeat,
  rollHeight,
  totalWidth,
  totalHeight,
  activeVoice,
  selectedNoteIds,
  diagnosticsByNote,
  missingExpectedNoteIds,
  interaction,
  noteRects,
  progressionPreview,
  tool,
  scaleGuideEnabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onDoubleClick,
}: NoteLayerProps) {
  const viewportCanvasRef = useRef<HTMLCanvasElement>(null);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => setThemeRevision((value) => value + 1);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () =>
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  useEffect(() => {
    const canvas = viewportCanvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rollTheme = readRollCanvasTheme();
    const ratio = window.devicePixelRatio || 1;
    const renderWidth = viewportSize.width;
    const renderHeight = viewportSize.height;
    const pixelWidth = Math.ceil(renderWidth * ratio);
    const pixelHeight = Math.ceil(renderHeight * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;

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

      context.fillStyle = rollTheme.bg;
      context.fillRect(visibleLeft, visibleTop, renderWidth, renderHeight);

      if (scaleGuideEnabled) {
        const sortedKeys = [...project.keyEvents].sort((a, b) => a.tick - b.tick);
        const keySegments: { startX: number; endX: number; key: KeyEvent }[] = [];
        for (let i = 0; i < sortedKeys.length; i++) {
          const currentKey = sortedKeys[i];
          const nextTick = sortedKeys[i + 1]?.tick ?? project.lengthTicks;
          const kLeft =
            i === 0
              ? PIANO_WIDTH
              : tickToX(currentKey.tick, project.ppq, pixelsPerBeat);
          const kRight =
            i === sortedKeys.length - 1
              ? Math.max(totalWidth, visibleRight)
              : tickToX(nextTick, project.ppq, pixelsPerBeat);
          if (kRight > visibleLeft && kLeft < visibleRight) {
            keySegments.push({
              startX: Math.max(PIANO_WIDTH, Math.max(kLeft, visibleLeft)),
              endX: Math.min(visibleRight, kRight),
              key: currentKey,
            });
          }
        }

        for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi -= 1) {
          const y = midiToY(midi);
          if (y > visibleBottom || y + ROW_HEIGHT < visibleTop) continue;
          const rowLeft = Math.max(PIANO_WIDTH, visibleLeft);

          keySegments.forEach((segment) => {
            if (segment.endX > segment.startX) {
              if (!isDiatonicPitch(midi, segment.key)) {
                context.fillStyle = rollTheme.rowAlt;
                context.fillRect(
                  segment.startX,
                  y,
                  segment.endX - segment.startX,
                  ROW_HEIGHT,
                );
              }
            }
          });

          context.strokeStyle =
            midi % 12 === 0 ? rollTheme.lineOctave : rollTheme.lineRow;
          context.lineWidth = midi % 12 === 0 ? 1.2 : 1;
          context.beginPath();
          context.moveTo(rowLeft, y + ROW_HEIGHT);
          context.lineTo(visibleRight, y + ROW_HEIGHT);
          context.stroke();
        }
      } else {
        for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi -= 1) {
          const y = midiToY(midi);
          if (y > visibleBottom || y + ROW_HEIGHT < visibleTop) continue;
          const rowLeft = Math.max(PIANO_WIDTH, visibleLeft);
          if (isBlackKey(midi)) {
            context.fillStyle = rollTheme.rowAlt;
            context.fillRect(rowLeft, y, visibleRight - rowLeft, ROW_HEIGHT);
          }
          context.strokeStyle =
            midi % 12 === 0 ? rollTheme.lineOctave : rollTheme.lineRow;
          context.lineWidth = midi % 12 === 0 ? 1.2 : 1;
          context.beginPath();
          context.moveTo(rowLeft, y + ROW_HEIGHT);
          context.lineTo(visibleRight, y + ROW_HEIGHT);
          context.stroke();
        }
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
            context.strokeStyle =
              beatIndex === 0 ? rollTheme.lineMeasure : rollTheme.lineBeat;
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
            context.strokeStyle = rollTheme.lineSub;
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
          context.fillStyle = rollTheme.lockFill;
          context.fillRect(x, HEADER_HEIGHT, width, rollHeight);
          context.save();
          context.setLineDash([4, 3]);
          context.strokeStyle = rollTheme.lockStroke;
          context.strokeRect(
            x + 0.5,
            HEADER_HEIGHT + 0.5,
            Math.max(0, width - 1),
            rollHeight - 1,
          );
          context.restore();
          context.fillStyle = rollTheme.lockText;
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
        const voiceColor = rollTheme.voices[track.id];
        context.fillStyle =
          track.id === activeVoice ? voiceColor : `${voiceColor}b8`;
        context.beginPath();
        context.roundRect(x, y, width, height, 3);
        context.fill();

        if (selectedNoteIds.has(note.id)) {
          context.strokeStyle = rollTheme.selectStroke;
          context.lineWidth = 2;
          context.stroke();
        }
        if (missingExpectedNoteIds?.has(note.id)) {
          context.save();
          context.setLineDash([4, 3]);
          context.strokeStyle = rollTheme.danger;
          context.lineWidth = 1.5;
          context.stroke();
          context.restore();
        }
        const issue = primaryDiagnostic(diagnosticsByNote.get(note.id) ?? []);
        if (issue) {
          context.fillStyle =
            issue.severity === "error"
              ? rollTheme.danger
              : issue.severity === "warning"
                ? rollTheme.warning
                : rollTheme.suggestion;
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
        context.fillStyle = rollTheme.marqueeFill;
        context.fillRect(left, top, width, height);
        context.save();
        context.setLineDash([4, 3]);
        context.strokeStyle = rollTheme.marqueeStroke;
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
    missingExpectedNoteIds,
    noteRects,
    pixelsPerBeat,
    project,
    rollHeight,
    scrollRef,
    selectedNoteIds,
    viewportSize,
    scaleGuideEnabled,
    themeRevision,
  ]);

  return (
    <>
      <canvas
        ref={viewportCanvasRef}
        className="roll-viewport-canvas"
        aria-hidden="true"
      />
      {progressionPreview && (
        <div className="roll-progression-preview" aria-hidden="true" style={{ pointerEvents: "none" }}>
          <div
            className="roll-progression-slot"
            style={{
              left: tickToX(progressionPreview.slotRange.fromTick, project.ppq, pixelsPerBeat),
              top: HEADER_HEIGHT,
              width: durationToWidth(progressionPreview.slotRange.toTick - progressionPreview.slotRange.fromTick, project.ppq, pixelsPerBeat),
              height: rollHeight,
            }}
          />
          {progressionPreview.ghostNotes?.map(note => {
            const voice = VOICE_CONFIG[note.voice];
            return (
              <div
                key={note.id}
                className="roll-progression-note"
                style={{
                  left: tickToX(note.startTick, project.ppq, pixelsPerBeat),
                  top: midiToY(toMidi(note.pitch)) + 2,
                  width: Math.max(5, durationToWidth(note.durationTicks, project.ppq, pixelsPerBeat, 1)),
                  height: ROW_HEIGHT - 4,
                  "--ghost-fill": voice.color,
                  "--ghost-ink": voice.darkColor,
                } as CSSProperties}
              >{formatSpelledPitch(note.pitch)}</div>
            );
          })}
        </div>
      )}
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
