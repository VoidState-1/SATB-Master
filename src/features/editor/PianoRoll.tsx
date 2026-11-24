import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  chordDraftFromRegion,
  defaultChordDraftAtTick,
} from "../../domain/chords";
import { buildMeasures, keyAtTick, snapTickBackward } from "../../domain/time";
import { toMidi } from "../../domain/pitch";
import type { HarmonyDiagnostic } from "../../domain/harmony";
import {
  buildTimelineRulerTicks,
  buildTimingMarkerGroups,
} from "../../domain/timelineRuler";
import { ChordPalette } from "./layers/ChordPalette";
import { ChordTrack } from "./layers/ChordTrack";
import { DiagnosticTooltip } from "./layers/DiagnosticTooltip";
import { NoteLayer } from "./layers/NoteLayer";
import { PianoKeys } from "./layers/PianoKeys";
import { PlayheadLayer } from "./layers/PlayheadLayer";
import { RulerContextMenu } from "./layers/RulerContextMenu";
import { TimelineRuler } from "./layers/TimelineRuler";
import { TimingMarkerPopover } from "./layers/TimingMarkerPopover";
import { groupDiagnostics } from "./geometry";
import type { DiagnosticTooltipState } from "./layers/types";
import { useNoteInteraction } from "./interactions/useNoteInteraction";
import { useChordInteraction } from "./interactions/useChordInteraction";
import {
  HEADER_HEIGHT,
  MAX_MIDI,
  MIN_MIDI,
  ROW_HEIGHT,
  calculateFollowPlayheadScrollLeft,
  createViewportMetrics,
  initialScrollTopForMidi,
  scrollLeftForZoom,
  tickToX,
  midiToY,
  PIANO_WIDTH,
  xToTick,
} from "./viewport";
import type { EditorDomain, PianoRollProps } from "./types";
import { stepTimelineZoom } from "./policy";
export type { EditorDomain, EditorTool, PianoRollProps } from "./types";

// 卷帘窗与工程模型共用标准 MIDI 0-127 音域，避免快捷键能移动到画布之外。
interface ChordPaletteState {
  chordId: string;
  anchor: { x: number; y: number };
}

interface TimingMarkerEditorState {
  tick: number;
  anchor: { x: number; y: number };
}

interface RulerContextMenuState {
  tick: number;
  measureStartTick: number;
  anchor: { x: number; y: number };
}

export function PianoRoll({
  project,
  activeVoice,
  tool,
  gridTicks,
  pixelsPerBeat,
  selectedNoteIds,
  selectedChordIds,
  focusRange,
  progressionPreview,
  chordBrush,
  diagnostics,
  missingExpectedNoteIds,
  missingExpectedChordIds,
  cadenceCandidates,
  playheadTick,
  isPlaying = false,
  followPlayhead = true,
  seekOnClick = false,
  onDisengageFollow,
  loopEnabled,
  loopStartTick,
  loopEndTick,
  cancelRequest,
  scaleGuideEnabled,
  onSetPlayhead,
  onSetPixelsPerBeat,
  onSetActiveVoice,
  onSetEditorDomain,
  onInteractionActiveChange,
  onSelectNotes,
  onPreviewNote,
  onSelectChords,
  onAddNote,
  onUpdateNote,
  onMoveNotes,
  onDeleteNotes,
  onSplitNote,
  onAddChord,
  onUpdateChord,
  onMoveChords,
  onDeleteChords,
  onSplitChord,
  onAddTimingEvent,
  onUpdateTimingEvent,
  onDeleteTimingEvent,
  onSetLoopBoundary,
}: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const lastScrollLeftRef = useRef(0);
  const previousPixelsPerBeatRef = useRef(pixelsPerBeat);
  const pendingZoomViewportXRef = useRef<number | undefined>(undefined);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  const disengageFollow = useCallback(() => {
    if (isPlaying && followPlayhead) {
      onDisengageFollow?.();
    }
  }, [followPlayhead, isPlaying, onDisengageFollow]);
  const [chordPalette, setChordPalette] = useState<ChordPaletteState>();
  const [timingMarkerEditor, setTimingMarkerEditor] =
    useState<TimingMarkerEditorState>();
  const [rulerContextMenu, setRulerContextMenu] =
    useState<RulerContextMenuState>();
  const [diagnosticTooltip, setDiagnosticTooltip] =
    useState<DiagnosticTooltipState>();
  const measures = useMemo(() => buildMeasures(project), [project]);
  const rulerTicks = useMemo(() => buildTimelineRulerTicks(project), [project]);
  const timingMarkerGroups = useMemo(
    () => buildTimingMarkerGroups(project),
    [project],
  );
  const diagnosticsByNote = useMemo(
    () => groupDiagnostics(diagnostics, "noteIds", "involved"),
    [diagnostics],
  );
  const diagnosticsByChord = useMemo(
    () => groupDiagnostics(diagnostics, "chordIds"),
    [diagnostics],
  );
  const { rollHeight, totalWidth, totalHeight } = createViewportMetrics(
    project.lengthTicks,
    project.ppq,
    pixelsPerBeat,
  );
  // 顶部轨道与 Canvas 共用 tick 到像素的换算，保证缩放和横向滚动后仍严格对齐。
  const measureGuidePositions = useMemo(
    () =>
      measures.map((measure) => ({
        startTick: measure.startTick,
        x: tickToX(measure.startTick, project.ppq, pixelsPerBeat),
      })),
    [measures, pixelsPerBeat, project.ppq],
  );
  const playheadX = tickToX(playheadTick, project.ppq, pixelsPerBeat);
  const loopStartX = tickToX(loopStartTick, project.ppq, pixelsPerBeat);
  const loopEndX = tickToX(loopEndTick, project.ppq, pixelsPerBeat);

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
  }, []);

  useLayoutEffect(() => {
    const previousPixelsPerBeat = previousPixelsPerBeatRef.current;
    const scroll = scrollRef.current;
    if (!scroll || previousPixelsPerBeat === pixelsPerBeat) return;
    const viewportX = pendingZoomViewportXRef.current ?? scroll.clientWidth / 2;
    scroll.scrollLeft = scrollLeftForZoom({
      scrollLeft: scroll.scrollLeft,
      viewportX,
      previousPixelsPerBeat,
      nextPixelsPerBeat: pixelsPerBeat,
      ppq: project.ppq,
    });
    lastScrollLeftRef.current = scroll.scrollLeft;
    previousPixelsPerBeatRef.current = pixelsPerBeat;
    pendingZoomViewportXRef.current = undefined;
  }, [pixelsPerBeat, project.ppq]);

  useLayoutEffect(() => {
    if (!isPlaying || !followPlayhead) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const nextScrollLeft = calculateFollowPlayheadScrollLeft({
      currentScrollLeft: scroll.scrollLeft,
      viewportWidth: scroll.clientWidth,
      playheadX,
    });
    if (nextScrollLeft !== scroll.scrollLeft) {
      isProgrammaticScrollRef.current = true;
      scroll.scrollLeft = nextScrollLeft;
      lastScrollLeftRef.current = scroll.scrollLeft;
      window.requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [followPlayhead, isPlaying, playheadX]);

  useEffect(() => {
    setTimingMarkerEditor(undefined);
    setRulerContextMenu(undefined);
  }, [cancelRequest]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && scroll.scrollTop === 0) {
      scroll.scrollTop = initialScrollTopForMidi(72);
    }
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !focusRange) return;
    scroll.scrollLeft = Math.max(0, tickToX(focusRange.fromTick, project.ppq, pixelsPerBeat) - PIANO_WIDTH - 24);
    lastScrollLeftRef.current = scroll.scrollLeft;
    const pitches = project.satbTracks.flatMap((track) => track.notes.filter((note) => focusRange.noteIds?.size
      ? focusRange.noteIds.has(note.id)
      : note.startTick < focusRange.toTick && focusRange.fromTick < note.startTick + note.durationTicks).map((note) => toMidi(note.pitch)));
    if (pitches.length) {
      let low = pitches[0];
      let high = pitches[0];
      for (const pitch of pitches) { low = Math.min(low, pitch); high = Math.max(high, pitch); }
      scroll.scrollTop = Math.max(0, midiToY((low + high) / 2) - scroll.clientHeight / 2 + ROW_HEIGHT / 2);
    }
    // 定位是离散请求, 普通工程编辑或缩放继续沿用原来的视口行为。
  }, [focusRange]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!seekOnClick || isPlaying || !scroll) return;
    const left = playheadX - scroll.scrollLeft;
    if (left < PIANO_WIDTH || left > scroll.clientWidth - 4) {
      scroll.scrollLeft = Math.max(0, playheadX - PIANO_WIDTH - 24);
      lastScrollLeftRef.current = scroll.scrollLeft;
    }
  }, [seekOnClick, playheadX, isPlaying, focusRange]);

  const rawTickAtX = (x: number) => {
    return xToTick(x, project.ppq, pixelsPerBeat, project.lengthTicks);
  };

  const snapStartTick = (x: number) =>
    snapTickBackward(rawTickAtX(x), gridTicks, project.lengthTicks - gridTicks);

  const focusEditor = (domain?: EditorDomain) => {
    if (domain) onSetEditorDomain(domain);
    scrollRef.current?.focus({ preventScroll: true });
  };

  const showDiagnosticTooltip = (
    event: React.PointerEvent,
    targetId: string,
    title: string,
    targetDiagnostics: HarmonyDiagnostic[],
  ) => {
    if (targetDiagnostics.length === 0) {
      setDiagnosticTooltip(undefined);
      return;
    }
    setDiagnosticTooltip((current) =>
      current?.targetId === targetId
        ? current
        : {
            targetId,
            title,
            x:
              event.clientX +
              (event.clientX > window.innerWidth - 340 ? -12 : 12),
            y:
              event.clientY +
              (event.clientY > window.innerHeight - 200 ? -12 : 12),
            alignLeft: event.clientX > window.innerWidth - 340,
            alignAbove: event.clientY > window.innerHeight - 200,
            diagnostics: targetDiagnostics,
          },
    );
  };

  const {
    interaction,
    noteRects,
    handlePointerDown,
    handlePointerMove,
    finishInteraction,
    cancelInteraction,
    handleDoubleClick: handleNoteDoubleClick,
  } = useNoteInteraction({
    project,
    activeVoice,
    tool,
    gridTicks,
    pixelsPerBeat,
    selectedNoteIds,
    diagnosticsByNote,
    scrollRef,
    cancelRequest,
    seekOnClick,
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
    clearDiagnosticTooltip: () => setDiagnosticTooltip(undefined),
  });

  const {
    chordInteraction,
    chordRects,
    handlePointerDown: handleChordPointerDown,
    handlePointerMove: handleChordPointerMove,
    finishInteraction: finishChordInteraction,
    cancelInteraction: cancelChordInteraction,
    handleDoubleClick: handleChordDoubleClick,
  } = useChordInteraction({
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
    onOpenChordPalette: (chordId, anchor) =>
      setChordPalette({ chordId, anchor }),
    clearDiagnosticTooltip: () => setDiagnosticTooltip(undefined),
  });

  useEffect(() => {
    onInteractionActiveChange(Boolean(interaction || chordInteraction));
  }, [chordInteraction, interaction, onInteractionActiveChange]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // 上下滚动音高视野不终止水平跟随；仅缩放或横向滚轮时解除跟随。
    const isVerticalOnlyWheel =
      !event.ctrlKey && !event.shiftKey && event.deltaX === 0;
    if (!isVerticalOnlyWheel) {
      disengageFollow();
    }
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const nextPixelsPerBeat = stepTimelineZoom(
        pixelsPerBeat,
        delta < 0 ? 1 : -1,
      );
      if (nextPixelsPerBeat === pixelsPerBeat) {
        pendingZoomViewportXRef.current = undefined;
        return;
      }
      const rect = scroll.getBoundingClientRect();
      pendingZoomViewportXRef.current = event.clientX - rect.left;
      onSetPixelsPerBeat(nextPixelsPerBeat);
      return;
    }
  };

  const handleRulerContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    focusEditor();
    const rect = event.currentTarget.getBoundingClientRect();
    const rawTick = rawTickAtX(event.clientX - rect.left);
    // 右键位置按当前网格向前吸附；拍号和调号仍由菜单限制在小节起点。
    const tick = snapTickBackward(rawTick, gridTicks, project.lengthTicks);
    const measure =
      measures.find(
        (candidate) => tick >= candidate.startTick && tick < candidate.endTick,
      ) ?? measures[measures.length - 1];
    setChordPalette(undefined);
    setTimingMarkerEditor(undefined);
    setDiagnosticTooltip(undefined);
    setRulerContextMenu({
      tick,
      measureStartTick: measure?.startTick ?? 0,
      anchor: { x: event.clientX, y: event.clientY },
    });
  };

  const paletteChord = chordPalette
    ? project.chordTrack.regions.find(
        (region) => region.id === chordPalette.chordId,
      )
    : undefined;

  const activeTimingMarker = timingMarkerEditor
    ? timingMarkerGroups.find((group) => group.tick === timingMarkerEditor.tick)
    : undefined;

  return (
    <div
      className="piano-roll"
      ref={scrollRef}
      tabIndex={0}
      data-min-midi={MIN_MIDI}
      data-max-midi={MAX_MIDI}
      data-row-height={ROW_HEIGHT}
      data-header-height={HEADER_HEIGHT}
      onPointerDownCapture={(event) => {
        if (event.button === 1) {
          disengageFollow();
        }
      }}
      onWheel={handleWheel}
      onScroll={() => {
        const scroll = scrollRef.current;
        const currentScrollLeft = scroll?.scrollLeft ?? 0;
        const horizontalChanged =
          Math.abs(currentScrollLeft - lastScrollLeftRef.current) > 0.5;
        lastScrollLeftRef.current = currentScrollLeft;
        if (isProgrammaticScrollRef.current) {
          isProgrammaticScrollRef.current = false;
          return;
        }
        if (horizontalChanged) {
          disengageFollow();
        }
        if (diagnosticTooltip) setDiagnosticTooltip(undefined);
        if (timingMarkerEditor) setTimingMarkerEditor(undefined);
        if (rulerContextMenu) setRulerContextMenu(undefined);
      }}
    >
      <div
        className="piano-roll-inner"
        style={{ width: totalWidth, height: totalHeight }}
      >
        <TimelineRuler
          project={project}
          totalWidth={totalWidth}
          pixelsPerBeat={pixelsPerBeat}
          measures={measures}
          rulerTicks={rulerTicks}
          timingMarkerGroups={timingMarkerGroups}
          measureGuidePositions={measureGuidePositions}
          playheadX={playheadX}
          loopEnabled={loopEnabled}
          loopStartX={loopStartX}
          loopEndX={loopEndX}
          activeTimingTick={timingMarkerEditor?.tick}
          onFocus={() => focusEditor()}
          onDoubleClick={(x) => onSetPlayhead(snapStartTick(x))}
          onClick={seekOnClick ? (x) => onSetPlayhead(snapStartTick(x)) : undefined}
          onContextMenu={handleRulerContextMenu}
          onTimingMarkerClick={onSetPlayhead}
          onTimingMarkerDoubleClick={(tick, anchor) =>
            setTimingMarkerEditor({ tick, anchor })
          }
        />

        <ChordTrack
          project={project}
          totalWidth={totalWidth}
          pixelsPerBeat={pixelsPerBeat}
          tool={tool}
          chordBrush={chordBrush}
          chordRects={chordRects}
          chordInteraction={chordInteraction}
          selectedChordIds={selectedChordIds}
          diagnosticsByChord={diagnosticsByChord}
          missingExpectedChordIds={missingExpectedChordIds}
          cadenceCandidates={cadenceCandidates}
          ghostChords={progressionPreview?.ghostChords}
          measureGuidePositions={measureGuidePositions}
          playheadX={playheadX}
          onPointerDown={handleChordPointerDown}
          onPointerMove={handleChordPointerMove}
          onPointerUp={finishChordInteraction}
          onPointerCancel={cancelChordInteraction}
          onDoubleClick={handleChordDoubleClick}
          onShowDiagnosticTooltip={showDiagnosticTooltip}
          onHideDiagnosticTooltip={() => setDiagnosticTooltip(undefined)}
        />

        {chordPalette && paletteChord ? (
          <ChordPalette
            draft={
              chordDraftFromRegion(paletteChord) ??
              defaultChordDraftAtTick(project, paletteChord.startTick)
            }
            keyEvent={keyAtTick(project.keyEvents, paletteChord.startTick)}
            anchor={chordPalette.anchor}
            onChange={(patch) =>
              onUpdateChord(paletteChord.id, {
                draft: paletteChord.semantics
                  ? patch
                  : {
                      ...defaultChordDraftAtTick(
                        project,
                        paletteChord.startTick,
                      ),
                      ...patch,
                    },
              })
            }
            onClose={() => setChordPalette(undefined)}
          />
        ) : null}

        {timingMarkerEditor && activeTimingMarker ? (
          <TimingMarkerPopover
            project={project}
            group={activeTimingMarker}
            anchor={timingMarkerEditor.anchor}
            canAddMeterOrKey={measures.some(
              (measure) => measure.startTick === activeTimingMarker.tick,
            )}
            onAdd={onAddTimingEvent}
            onUpdate={onUpdateTimingEvent}
            onDelete={onDeleteTimingEvent}
            onClose={() => setTimingMarkerEditor(undefined)}
          />
        ) : null}

        {rulerContextMenu ? (
          <RulerContextMenu
            project={project}
            tick={rulerContextMenu.tick}
            measureStartTick={rulerContextMenu.measureStartTick}
            loopStartTick={loopStartTick}
            loopEndTick={loopEndTick}
            anchor={rulerContextMenu.anchor}
            onAdd={(type, tick) => {
              onAddTimingEvent(type, tick);
              setTimingMarkerEditor({ tick, anchor: rulerContextMenu.anchor });
            }}
            onSetLoopBoundary={onSetLoopBoundary}
            onClose={() => setRulerContextMenu(undefined)}
          />
        ) : null}

        <NoteLayer
          scrollRef={scrollRef}
          viewportSize={viewportSize}
          project={project}
          measures={measures}
          pixelsPerBeat={pixelsPerBeat}
          rollHeight={rollHeight}
          totalWidth={totalWidth}
          totalHeight={totalHeight}
          activeVoice={activeVoice}
          selectedNoteIds={selectedNoteIds}
          diagnosticsByNote={diagnosticsByNote}
          missingExpectedNoteIds={missingExpectedNoteIds}
          interaction={interaction}
          noteRects={noteRects}
          progressionPreview={progressionPreview}
          tool={tool}
          scaleGuideEnabled={scaleGuideEnabled}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onPointerCancel={cancelInteraction}
          onPointerLeave={() => setDiagnosticTooltip(undefined)}
          onDoubleClick={handleNoteDoubleClick}
        />

        <PlayheadLayer x={playheadX} height={rollHeight} />
        <PianoKeys
          height={rollHeight}
          onPreviewNote={(midi) => onPreviewNote(activeVoice, midi)}
          onFocus={() => focusEditor("notes")}
        />
      </div>
      <DiagnosticTooltip state={diagnosticTooltip} />
    </div>
  );
}
