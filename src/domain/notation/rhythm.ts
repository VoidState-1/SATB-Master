import type {
  NotationDuration,
  NotationDurationValue,
} from "./types";

const BASE_VALUES: readonly {
  value: NotationDurationValue;
  quarterMultiplier: number;
}[] = [
  { value: "w", quarterMultiplier: 4 },
  { value: "h", quarterMultiplier: 2 },
  { value: "q", quarterMultiplier: 1 },
  { value: "8", quarterMultiplier: 0.5 },
  { value: "16", quarterMultiplier: 0.25 },
  { value: "32", quarterMultiplier: 0.125 },
  { value: "64", quarterMultiplier: 0.0625 },
];

export function durationTicks(
  ppq: number,
  value: NotationDurationValue,
  dots = 0,
) {
  const base = BASE_VALUES.find((candidate) => candidate.value === value);
  if (!base || dots < 0 || dots > 1) return undefined;
  const multiplier = dots === 1 ? 1.5 : 1;
  return ppq * base.quarterMultiplier * multiplier;
}

export function decomposeDuration(
  ppq: number,
  ticks: number,
): readonly NotationDuration[] | undefined {
  if (!Number.isInteger(ppq) || ppq <= 0 || !Number.isInteger(ticks) || ticks <= 0)
    return undefined;

  const candidates = BASE_VALUES.flatMap((base) =>
    [0, 1].map((dots) => ({
      value: base.value,
      dots,
      ticks: durationTicks(ppq, base.value, dots)!,
    })),
  )
    .filter((candidate) => Number.isInteger(candidate.ticks))
    .sort(
      (left, right) =>
        right.ticks - left.ticks || left.dots - right.dots,
    );
  if (candidates.length === 0) return undefined;

  const result: NotationDuration[] = [];
  let remaining = ticks;
  while (remaining > 0) {
    const candidate = candidates.find((item) => item.ticks <= remaining);
    if (!candidate) return undefined;
    result.push({ ...candidate });
    remaining -= candidate.ticks;
  }
  return result;
}

