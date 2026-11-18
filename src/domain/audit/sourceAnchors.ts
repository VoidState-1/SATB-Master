import { positionTick } from "../scoreText";
import type { MeasureInfo } from "../time";
import type { AuditBeatAnchor } from "./types";

export type LocatedBeatAnchor = AuditBeatAnchor & { tick: number };

export function locateSourceBeats(anchors: readonly AuditBeatAnchor[], measures: readonly MeasureInfo[], editedTimeline = false): LocatedBeatAnchor[] {
  const located: LocatedBeatAnchor[] = [];
  for (const anchor of anchors) {
    try {
      const tick = positionTick(anchor.position, measures);
      if (tick === measures.at(-1)?.endTick) throw new Error(`原图拍点 ${anchor.position} 位于工程结束线`);
      located.push({ ...anchor, tick });
    } catch (error) {
      // An independently edited copy can be shorter or use a different meter than its source.
      if (!editedTimeline) throw error;
    }
  }
  located.sort((a, b) => a.tick - b.tick);
  if (!editedTimeline && located.some((a, i) => i > 0 && a.tick === located[i - 1].tick)) throw new Error("原图包含重复拍点");
  return located;
}

/** 只在实际标过的拍点上画精确游标。同行两个已知点之间最多能确定谱行。 */
export function sourceBeatAt(anchors: readonly LocatedBeatAnchor[], tick: number) {
  const nextIndex = anchors.findIndex((a) => a.tick >= tick);
  if (nextIndex < 0) return {};
  const next = anchors[nextIndex];
  if (next.tick === tick) return { beat: next };
  const previous = anchors[nextIndex - 1];
  if (previous && Math.max(previous.top, next.top) < Math.min(previous.bottom, next.bottom)) {
    return { row: { top: Math.min(previous.top, next.top), bottom: Math.max(previous.bottom, next.bottom) } };
  }
  return {};
}

export function nearestSourceBeat(anchors: readonly LocatedBeatAnchor[], x: number, y: number) {
  let nearest: LocatedBeatAnchor | undefined;
  for (const anchor of anchors) {
    if (y < anchor.top || y > anchor.bottom) continue;
    if (!nearest || Math.abs(anchor.x - x) < Math.abs(nearest.x - x)) nearest = anchor;
  }
  return nearest;
}
