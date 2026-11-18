import type { CadenceAnnotation, ChordRegion, PhraseBoundary } from "./types";

export function cadenceChordCoverage(
  { fromTick, toTick }: Pick<CadenceAnnotation, "fromTick" | "toTick">,
  regions: readonly ChordRegion[],
  boundaries: readonly PhraseBoundary[],
) {
  const overlapping = regions.filter(region =>
    region.startTick < toTick && fromTick < region.startTick + region.durationTicks,
  ).sort((left, right) => left.startTick - right.startTick);
  const first = overlapping[0], last = overlapping.at(-1);
  const isPhraseEdge = (tick: number) => boundaries.some(boundary => boundary.tick === tick && !boundary.stale);
  const aligned = !!first && !!last &&
    (first.startTick === fromTick || (first.startTick < fromTick && isPhraseEdge(fromTick))) &&
    (last.startTick + last.durationTicks === toTick || (toTick < last.startTick + last.durationTicks && isPhraseEdge(toTick)));
  const continuous = aligned && overlapping.every((region, index) =>
    index === 0 || overlapping[index - 1].startTick + overlapping[index - 1].durationTicks === region.startTick,
  );
  return { aligned, continuous };
}
