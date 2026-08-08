import type { MouseEvent } from "react";
import { formatPitchClass } from "../../../domain/pitch";
import type { ProjectDocument } from "../../../domain/project";
import type { MeasureInfo } from "../../../domain/time";
import type {
  TimelineRulerTick,
  TimingMarkerGroup,
} from "../../../domain/timelineRuler";
import { tickToX } from "../viewport";
import type { MeasureGuidePosition } from "./types";

interface TimelineRulerProps {
  project: ProjectDocument;
  totalWidth: number;
  pixelsPerBeat: number;
  measures: MeasureInfo[];
  rulerTicks: TimelineRulerTick[];
  timingMarkerGroups: TimingMarkerGroup[];
  measureGuidePositions: MeasureGuidePosition[];
  loopEnabled: boolean;
  loopStartX: number;
  loopEndX: number;
  activeTimingTick?: number;
  onFocus(): void;
  onDoubleClick(x: number): void;
  onContextMenu(event: MouseEvent<HTMLDivElement>): void;
  onTimingMarkerClick(tick: number): void;
  onTimingMarkerDoubleClick(
    tick: number,
    anchor: { x: number; y: number },
  ): void;
}

export function TimelineRuler({
  project,
  totalWidth,
  pixelsPerBeat,
  measures,
  rulerTicks,
  timingMarkerGroups,
  measureGuidePositions,
  loopEnabled,
  loopStartX,
  loopEndX,
  activeTimingTick,
  onFocus,
  onDoubleClick,
  onContextMenu,
  onTimingMarkerClick,
  onTimingMarkerDoubleClick,
}: TimelineRulerProps) {
  return (
    <div
      className="ruler-lane"
      style={{ width: totalWidth }}
      onPointerDown={onFocus}
      onDoubleClick={(event) =>
        onDoubleClick(
          event.clientX - event.currentTarget.getBoundingClientRect().left,
        )
      }
      onContextMenu={onContextMenu}
    >
      <span className="lane-sticky-label">小节</span>
      <span
        className={`ruler-loop-range ${loopEnabled ? "is-enabled" : ""}`}
        style={{ left: loopStartX, width: Math.max(0, loopEndX - loopStartX) }}
        aria-hidden="true"
      />
      <span
        className={`ruler-loop-marker start ${loopEnabled ? "is-enabled" : ""}`}
        style={{ left: loopStartX }}
        aria-hidden="true"
      />
      <span
        className={`ruler-loop-marker end ${loopEnabled ? "is-enabled" : ""}`}
        style={{ left: loopEndX }}
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
      {measures.map((measure) => (
        <span
          key={measure.startTick}
          className="measure-number"
          style={{
            left: tickToX(measure.startTick, project.ppq, pixelsPerBeat),
          }}
        >
          {measure.number}
        </span>
      ))}
      {rulerTicks.map((tick) => (
        <span
          key={`${tick.kind}-${tick.tick}`}
          className={`ruler-scale-tick ${tick.kind}`}
          style={{ left: tickToX(tick.tick, project.ppq, pixelsPerBeat) }}
          aria-hidden="true"
        />
      ))}
      {timingMarkerGroups.map((group) => {
        const label = [
          group.tempo ? `♩=${group.tempo.bpm}` : undefined,
          group.meter
            ? `${group.meter.numerator}/${group.meter.denominator}`
            : undefined,
          group.key
            ? `${formatPitchClass(group.key.tonic)} ${group.key.mode === "major" ? "大调" : "小调"}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <button
            type="button"
            key={group.tick}
            className={`timing-marker-group ${activeTimingTick === group.tick ? "is-active" : ""}`}
            style={{
              left: tickToX(group.tick, project.ppq, pixelsPerBeat),
            }}
            aria-label={`时间变化 ${label}`}
            title={label}
            onClick={(event) => {
              event.stopPropagation();
              onTimingMarkerClick(group.tick);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onFocus();
              const rect = event.currentTarget.getBoundingClientRect();
              onTimingMarkerDoubleClick(group.tick, {
                x: rect.left,
                y: rect.bottom,
              });
            }}
          >
            {group.tempo ? <span className="tempo">♩={group.tempo.bpm}</span> : null}
            {group.meter ? (
              <span className="meter">
                {group.meter.numerator}/{group.meter.denominator}
              </span>
            ) : null}
            {group.key ? (
              <span className="key">
                {formatPitchClass(group.key.tonic)}{" "}
                {group.key.mode === "major" ? "大调" : "小调"}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
