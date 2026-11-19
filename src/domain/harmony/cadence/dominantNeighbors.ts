import { chordIdentityEquals } from "../../chordModel";
import { pitchClassEquals } from "../../pitch";
import type { MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { writtenNeighborsOverHeldBass } from "../writtenNeighbors";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

/** Spasobin §§40.1–2, 40.4. Recognize two returning upper neighbors within one stationary dominant. */
export function dominantNeighborEvidence(
  left: CadenceSpanFacts,
  right: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  metricAt: (tick: number) => MetricPosition | undefined,
): CadenceEvidence | undefined {
  const identity = left.chord?.identity;
  if (!identity || !right.chord || !chordIdentityEquals(identity, right.chord.identity) ||
      identity.structure.kind !== "tertian" || identity.structure.alterations.length ||
      identity.structure.extensions.length ||
      (identity.structure.quality !== "major" && identity.structure.quality !== "dominant7")) return;

  const before = slices[left.span.sliceIndices.at(-1)!];
  const after = slices[right.span.sliceIndices[0]];
  const middle = before && slices[before.index + 1];
  if (!middle || !after || after.index !== middle.index + 1 || middle.chord ||
      before.endTick !== left.span.toTick || middle.tick !== before.endTick ||
      middle.endTick !== right.span.fromTick || after.tick !== middle.endTick ||
      before.key.id !== middle.key.id || middle.key.id !== after.key.id ||
      !before.completeSatb || !middle.completeSatb || !after.completeSatb) return;
  const metric = metricAt(middle.tick);
  if (metric?.confidence !== "certain" || metric.level >= 2) return;

  if (!pitchClassEquals(middle.notes.bass!.pitch, identity.root)) return;
  const neighbors = writtenNeighborsOverHeldBass(identity, before, middle, after);
  if (neighbors?.length !== 2) return;

  return {
    code: "dominant-neighbor-prolongation",
    value: "持续属低音上的两个弱位辅助音同声部折回，属功能连续",
    refs: neighbors,
  };
}
