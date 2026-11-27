export interface GridOption {
  readonly label: string;
  readonly ticks: number;
}

export const GRID_OPTIONS: readonly GridOption[] = Object.freeze([
  { label: "1/4", ticks: 960 },
  { label: "1/8", ticks: 480 },
  { label: "1/8 三连音", ticks: 320 },
  { label: "1/16", ticks: 240 },
  { label: "1/16 三连音", ticks: 160 },
  { label: "1/32", ticks: 120 },
  { label: "1/32 三连音", ticks: 80 },
  { label: "1/64", ticks: 60 },
  { label: "1/64 三连音", ticks: 40 },
  { label: "1/128", ticks: 30 },
]);

export const DEFAULT_GRID_TICKS = 480;
export const DEFAULT_PIXELS_PER_BEAT = 72;

export const TIMELINE_ZOOM = Object.freeze({ min: 10, max: 200, step: 10 });

export function nextGridResolution(current: number, direction: 1 | -1) {
  const currentIndex = GRID_OPTIONS.findIndex(
    (option) => option.ticks === current,
  );
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = Math.max(
    0,
    Math.min(GRID_OPTIONS.length - 1, safeIndex + direction),
  );
  return GRID_OPTIONS[nextIndex]?.ticks ?? DEFAULT_GRID_TICKS;
}

export function stepTimelineZoom(current: number, direction: 1 | -1) {
  return Math.max(
    TIMELINE_ZOOM.min,
    Math.min(TIMELINE_ZOOM.max, current + direction * TIMELINE_ZOOM.step),
  );
}
