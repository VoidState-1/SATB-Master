import type { CadenceCandidate } from "../../domain/harmony";
import type { CadenceAnnotation, ProjectDocument } from "../../domain/project";
import { formatPosition } from "../../domain/time";

type DisplayCadence = CadenceAnnotation | CadenceCandidate;

export const cadenceKindLabels = {
  full: "全终止", half: "半终止", supplementary: "补充终止", deceptive: "阻碍终止",
};

export function cadenceRangeKey(item: DisplayCadence) {
  return `${item.fromTick}-${item.toTick}`;
}

export function cadencesOverlappingChord(
  annotations: readonly CadenceAnnotation[],
  candidates: readonly CadenceCandidate[],
  startTick: number,
  endTick: number,
): DisplayCadence[] {
  const overlaps = (item: DisplayCadence) => item.fromTick < endTick && startTick < item.toTick;
  const accepted = annotations.filter(overlaps);
  const acceptedRanges = new Set(accepted.map(cadenceRangeKey));
  return [...accepted, ...candidates.filter(item => overlaps(item) && !acceptedRanges.has(cadenceRangeKey(item)))];
}

export function cadenceRangeLabel(project: ProjectDocument, item: DisplayCadence) {
  // Include the exclusive end so the last barline reads as the next downbeat.
  const timeline = { ppq: project.ppq, meterEvents: project.meterEvents, lengthTicks: project.lengthTicks + 1 };
  return `${cadenceKindLabels[item.kind]} · ${formatPosition(timeline, item.fromTick)} – ${formatPosition(timeline, item.toTick)}`;
}
