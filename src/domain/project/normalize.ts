import { chordDraftFromIdentity, resolveChordIdentity } from "../chordModel";
import { toMidi } from "../pitch";
import { cloneProject, getAllPlayableTracks } from "./selectors";
import type { ProjectDocument } from "./types";

export function reconcileChordIdentities(project: ProjectDocument) {
  project.chordTrack.regions = project.chordTrack.regions.map((region) => {
    if (!region.semantics) return region;
    const key = [...project.keyEvents]
      .sort((left, right) => left.tick - right.tick)
      .filter((event) => event.tick <= region.startTick)
      .at(-1);
    return key
      ? {
          ...region,
          identity: resolveChordIdentity(
            chordDraftFromIdentity(region.identity, region.semantics),
            key,
          ),
        }
      : region;
  });
  return project;
}

function normalizePhraseBoundaries(project: ProjectDocument) {
  const byTick = new Map<number, ProjectDocument["structure"]["phraseBoundaries"][number]>();
  for (const boundary of project.structure.phraseBoundaries) {
    const tick = Math.max(0, Math.min(project.lengthTicks, Math.round(boundary.tick)));
    if (tick <= 0 || tick >= project.lengthTicks) continue;
    const previous = byTick.get(tick);
    if (!previous || boundary.confidence === "certain")
      byTick.set(tick, { ...boundary, tick });
  }
  project.structure.phraseBoundaries = [...byTick.values()].sort(
    (left, right) => left.tick - right.tick,
  );
}

export function normalizeProject(project: ProjectDocument): ProjectDocument {
  const normalized = cloneProject(project);
  const maximumStartTick = Math.max(0, normalized.lengthTicks - 1);
  const startTick = Math.max(
    0,
    Math.min(maximumStartTick, Math.round(normalized.loop.startTick)),
  );
  const endTick = Math.max(
    startTick + 1,
    Math.min(normalized.lengthTicks, Math.round(normalized.loop.endTick)),
  );
  normalized.loop = {
    enabled: normalized.loop.enabled,
    startTick,
    endTick,
  };
  normalized.tempoEvents.sort((a, b) => a.tick - b.tick);
  normalized.meterEvents.sort((a, b) => a.tick - b.tick);
  normalized.keyEvents.sort((a, b) => a.tick - b.tick);
  normalizePhraseBoundaries(normalized);
  // 调号编辑会改变其后功能和弦的书写实体；保存前统一收敛为同一事实来源。
  reconcileChordIdentities(normalized);
  normalized.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
  getAllPlayableTracks(normalized).forEach((track) =>
    track.notes.sort(
      (a, b) => a.startTick - b.startTick || toMidi(a.pitch) - toMidi(b.pitch),
    ),
  );
  return normalized;
}
