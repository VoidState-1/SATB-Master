import { chordIdentityEquals, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { MetricPosition } from "../../rhythm/metric";
import type { AnalysisSlice } from "../analysis";
import { hasCompleteWrittenTertianVoicing } from "../writtenTertian";
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

  const tones = chordIdentityToneSpellings(identity);
  const contains = (pitch: (typeof tones)[number]) => tones.some(tone => pitchClassEquals(tone, pitch));
  const bass = middle.notes.bass!;
  if (!pitchClassEquals(bass.pitch, identity.root) ||
      !tones.every(tone => VOICE_ORDER.some(voice => pitchClassEquals(before.notes[voice]!.pitch, tone)))) return;

  const neighbors: string[] = [];
  for (const voice of VOICE_ORDER) {
    const first = before.notes[voice]!;
    const neighbor = middle.notes[voice]!;
    const last = after.notes[voice]!;
    if (first.nonChordToneRole || last.nonChordToneRole || !contains(first.pitch) ||
        !spelledPitchEquals(first.pitch, last.pitch) ||
        toMidi(first.pitch) < toMidi(bass.pitch) || toMidi(neighbor.pitch) < toMidi(bass.pitch)) return;
    if (first.id === neighbor.id && neighbor.id === last.id) continue;
    if (voice === "bass" || (neighbor.nonChordToneRole && neighbor.nonChordToneRole !== "neighbor") ||
        contains(neighbor.pitch) || neighbor.startTick !== middle.tick || last.startTick !== after.tick ||
        first.startTick + first.durationTicks !== middle.tick ||
        neighbor.startTick + neighbor.durationTicks !== after.tick ||
        neighbor.durationTicks > Math.min(first.durationTicks, last.durationTicks)) return;
    const step = writtenInterval(first.pitch, neighbor.pitch);
    if (!isWrittenStep(step) || Math.sign(step.semitones) !== step.diatonicSteps) return;
    neighbors.push(neighbor.id);
  }
  if (neighbors.length !== 2 || hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => middle.notes[voice]!.pitch))) return;

  return {
    code: "dominant-neighbor-prolongation",
    value: "持续属低音上的两个弱位辅助音同声部折回，属功能连续",
    refs: neighbors,
  };
}
