import type { ChordRegion } from "../../project/types";
import type { MetricTimeline } from "../../rhythm/metric";
import type { PhraseAnalysisInput } from "./types";

export function measureAt(
  timeline: MetricTimeline,
  tick: number,
) {
  return timeline.measures.find(
    (measure) => measure.startTick <= tick && tick < measure.endTick,
  ) ?? timeline.measures.at(-1);
}

export function voicesEndingAt(project: PhraseAnalysisInput, tick: number) {
  return project.satbTracks?.filter((track) => track.notes.some(
    (note) => note.startTick + note.durationTicks === tick,
  )).length ?? 0;
}

export function voicesStartingAt(project: PhraseAnalysisInput, tick: number) {
  return project.satbTracks?.filter((track) => track.notes.some(
    (note) => note.startTick === tick,
  )).length ?? 0;
}

export function terminalRegionAt(regions: readonly ChordRegion[], tick: number) {
  return regions.find((region) => region.startTick + region.durationTicks === tick);
}

export function previousRegion(regions: readonly ChordRegion[], region: ChordRegion | undefined) {
  return region
    ? regions.find((candidate) => candidate.startTick + candidate.durationTicks === region.startTick)
    : undefined;
}

export function followingRegion(regions: readonly ChordRegion[], tick: number) {
  return regions.find((region) => region.startTick === tick);
}

export { keyEquals as sameKey } from "../../pitch";

export function confirmedFullCadences(project: PhraseAnalysisInput) {
  return (project.chordTrack?.cadenceAnnotations ?? []).filter(cadence =>
    cadence.kind === "full" && !cadence.stale);
}
