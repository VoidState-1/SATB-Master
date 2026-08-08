export const MIN_MIDI = 0;
export const MAX_MIDI = 127;
export const ROW_HEIGHT = 22;
export const PIANO_WIDTH = 58;
export const RULER_HEIGHT = 46;
export const HEADER_HEIGHT = RULER_HEIGHT + 42;

export interface EditorViewportMetrics {
  rollHeight: number;
  timelineWidth: number;
  totalWidth: number;
  totalHeight: number;
}

export function createViewportMetrics(
  lengthTicks: number,
  ppq: number,
  pixelsPerBeat: number,
): EditorViewportMetrics {
  const rollHeight = (MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT;
  const timelineWidth = Math.max(
    920,
    (lengthTicks / ppq) * pixelsPerBeat,
  );
  return {
    rollHeight,
    timelineWidth,
    totalWidth: timelineWidth + PIANO_WIDTH,
    totalHeight: rollHeight + HEADER_HEIGHT,
  };
}

export function tickToX(
  tick: number,
  ppq: number,
  pixelsPerBeat: number,
): number {
  return PIANO_WIDTH + (tick / ppq) * pixelsPerBeat;
}

export function xToTick(
  x: number,
  ppq: number,
  pixelsPerBeat: number,
  lengthTicks: number,
): number {
  const raw = ((x - PIANO_WIDTH) / pixelsPerBeat) * ppq;
  return Math.max(0, Math.min(lengthTicks, raw));
}

export function midiToY(midiNote: number): number {
  return HEADER_HEIGHT + (MAX_MIDI - midiNote) * ROW_HEIGHT;
}

export function yToMidi(y: number): number {
  return Math.max(
    MIN_MIDI,
    Math.min(MAX_MIDI, MAX_MIDI - Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT)),
  );
}

export function durationToWidth(
  durationTicks: number,
  ppq: number,
  pixelsPerBeat: number,
  trailingPadding = 0,
): number {
  return Math.max(
    0,
    (durationTicks / ppq) * pixelsPerBeat - trailingPadding,
  );
}

/**
 * Keep the tick under the zoom anchor fixed while the horizontal scale changes.
 * The scroll container owns the actual mutation; this function only derives the
 * next scrollLeft so that zooming remains deterministic and testable.
 */
export function scrollLeftForZoom(options: {
  scrollLeft: number;
  viewportX: number;
  previousPixelsPerBeat: number;
  nextPixelsPerBeat: number;
  ppq: number;
}): number {
  const {
    scrollLeft,
    viewportX,
    previousPixelsPerBeat,
    nextPixelsPerBeat,
    ppq,
  } = options;
  const tickAtAnchor = Math.max(
    0,
    ((scrollLeft + viewportX - PIANO_WIDTH) / previousPixelsPerBeat) * ppq,
  );
  return tickToX(tickAtAnchor, ppq, nextPixelsPerBeat) - viewportX;
}

export function initialScrollTopForMidi(midiNote: number): number {
  return Math.max(0, midiToY(midiNote) - HEADER_HEIGHT);
}
