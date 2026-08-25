import type { CadenceCandidate, HarmonyDiagnostic } from "../../../domain/harmony";
import { formatChord, formatChordRegion } from "../../../domain/chords";
import { keyAtTick } from "../../../domain/time";
import type { ChordDraft, ProjectDocument } from "../../../domain/project";
import { primaryDiagnostic } from "../geometry";
import type { ChordInteraction } from "../interactions/types";
import type { EditorTool } from "../types";
import { durationToWidth, tickToX } from "../viewport";
import type { ChordRect, MeasureGuidePosition } from "./types";

interface ChordTrackProps {
  project: ProjectDocument;
  totalWidth: number;
  pixelsPerBeat: number;
  tool: EditorTool;
  chordBrush: ChordDraft;
  chordRects: ChordRect[];
  chordInteraction?: ChordInteraction;
  selectedChordIds: Set<string>;
  diagnosticsByChord: Map<string, HarmonyDiagnostic[]>;
  missingExpectedChordIds?: ReadonlySet<string>;
  cadenceCandidates?: readonly CadenceCandidate[];
  measureGuidePositions: MeasureGuidePosition[];
  playheadX: number;
  onPointerDown(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerCancel(): void;
  onDoubleClick(event: React.MouseEvent<HTMLDivElement>): void;
  onShowDiagnosticTooltip(
    event: React.PointerEvent,
    targetId: string,
    title: string,
    diagnostics: HarmonyDiagnostic[],
  ): void;
  onHideDiagnosticTooltip(): void;
}

export function ChordTrack({
  project,
  totalWidth,
  pixelsPerBeat,
  tool,
  chordBrush,
  chordRects,
  chordInteraction,
  selectedChordIds,
  diagnosticsByChord,
  missingExpectedChordIds,
  cadenceCandidates,
  measureGuidePositions,
  playheadX,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onShowDiagnosticTooltip,
  onHideDiagnosticTooltip,
}: ChordTrackProps) {
  return (
    <div
      className={`chord-lane tool-${tool} ${chordInteraction?.kind === "pan" ? "is-panning" : ""}`}
      style={{ width: totalWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onAuxClick={(event) => event.preventDefault()}
    >
      <span className="lane-sticky-label">和弦</span>
      <span
        className="timeline-playhead-segment is-chord"
        style={{ left: playheadX }}
        aria-hidden="true"
      />
      {measureGuidePositions.map((guide) => (
        <span
          key={guide.startTick}
          className="timeline-measure-line"
          style={{ left: guide.x }}
          aria-hidden="true"
        />
      ))}
      {chordRects.map(
        ({ region: chord, startTick, durationTicks, x, width }) => {
          const formatted = formatChordRegion(project, {
            ...chord,
            startTick,
            durationTicks,
          });
          const chordDiagnostics = diagnosticsByChord.get(chord.id) ?? [];
          const issue = primaryDiagnostic(chordDiagnostics);
          const annotation = project.chordTrack.cadenceAnnotations.find(
            (candidate) =>
              candidate.fromTick <= startTick &&
              startTick + durationTicks <= candidate.toTick,
          );
          const detected = cadenceCandidates?.find(
            (candidate) =>
              candidate.fromTick <= startTick &&
              startTick + durationTicks <= candidate.toTick,
          );
          const cadence = annotation ?? detected;
          const display =
            project.chordTrack.displayMode === "functional"
              ? formatted.functional
              : project.chordTrack.displayMode === "roman"
                ? formatted.roman
                : project.chordTrack.displayMode === "absolute"
                  ? formatted.absolute
                  : project.chordTrack.displayMode === "functional-absolute"
                    ? `${formatted.functional}  ${formatted.absolute}`
                    : `${formatted.roman}  ${formatted.absolute}`;
          const fullLabel = `${formatted.functional} · ${formatted.roman} · ${formatted.absolute}`;
          return (
            <button
              type="button"
              key={chord.id}
              tabIndex={-1}
              className={`chord-block ${cadence ? `cadence-${cadence.kind}` : ""} ${detected && !annotation ? "cadence-is-candidate" : ""} ${selectedChordIds.has(chord.id) ? "is-selected" : ""} ${chord.locked ? "is-locked" : ""} ${issue ? `has-${issue.severity}` : ""} ${missingExpectedChordIds?.has(chord.id) ? "has-missing-expectation" : ""}`}
              style={{ left: x, width }}
              title={
                chordDiagnostics.length === 0
                ? `${fullLabel}${cadence ? ` · ${cadence.kind}` : ""}${chord.locked ? "（已锁定）" : ""}`
                  : undefined
              }
              onPointerEnter={(event) =>
                onShowDiagnosticTooltip(
                  event,
                  `chord:${chord.id}`,
                  fullLabel,
                  chordDiagnostics,
                )
              }
              onPointerLeave={onHideDiagnosticTooltip}
            >
              <span className="chord-resize-handle left" />
              <span className="chord-label">{display}</span>
              <span className="chord-resize-handle right" />
            </button>
          );
        },
      )}
      {chordInteraction?.kind === "draw" ? (
        <div
          className="chord-block chord-preview"
          style={{
            left: tickToX(
              chordInteraction.nextStartTick,
              project.ppq,
              pixelsPerBeat,
            ),
            width: Math.max(
              5,
              durationToWidth(
                chordInteraction.nextDurationTicks,
                project.ppq,
                pixelsPerBeat,
                2,
              ),
            ),
          }}
        >
          {
            formatChord(
              chordBrush,
              keyAtTick(project.keyEvents, chordInteraction.nextStartTick),
            ).roman
          }
        </div>
      ) : null}
      {chordInteraction?.kind === "marquee" ? (
        <div
          className="chord-marquee"
          style={{
            left: Math.min(chordInteraction.originX, chordInteraction.currentX),
            width: Math.abs(
              chordInteraction.currentX - chordInteraction.originX,
            ),
          }}
        />
      ) : null}
    </div>
  );
}
