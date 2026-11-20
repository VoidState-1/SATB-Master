import {
  chordIdentityEquals, chordIdentityInversion, type ChordIdentity,
} from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisSlice } from "../analysis";
import { returnsByWrittenStep, soundsCompleteWrittenChord } from "../writtenNeighbors";
import type { CadenceSpanFacts } from "./types";

function isPlainTriad(identity: ChordIdentity) {
  const structure = identity.structure;
  return structure.kind === "tertian" && (structure.quality === "major" || structure.quality === "minor") &&
    !structure.extensions.length && !structure.alterations.length;
}

function hasWrittenVoicing(slice: AnalysisSlice, identity: ChordIdentity, throughTick: number) {
  if (!slice.completeSatb) return false;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  return notes.every(note => note.startTick + note.durationTicks >= throughTick) &&
    soundsCompleteWrittenChord(identity, notes, slice.notes.bass!);
}

/** A written upper-neighbor pair around the same held tonic (§13.4–5). */
export function isWrittenAuxiliaryReturn(
  tonic: CadenceSpanFacts,
  auxiliary: CadenceSpanFacts,
  returning: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
) {
  const first = tonic.chord?.identity;
  const middle = auxiliary.chord?.identity;
  const last = returning.chord?.identity;
  const role = auxiliary.span.semantics?.cadenceRole;
  if (!first || !middle || !last || !isPlainTriad(first) || !isPlainTriad(middle) ||
      chordIdentityInversion(first) !== 0 || !chordIdentityEquals(first, last) ||
      !pitchClassEquals(first.root, tonic.key.tonic) || chordIdentityInversion(middle) !== 2 ||
      !pitchClassEquals(middle.root, scaleDegreePitchClass(tonic.key, 4)) ||
      (role && role !== "pedal64")) return false;

  const before = slices[tonic.span.sliceIndices.at(-1)!];
  const neighbor = auxiliary.boundarySlice;
  const arrival = returning.boundarySlice;
  if (!before || !neighbor || !arrival || before.key.id !== neighbor.key.id || neighbor.key.id !== arrival.key.id ||
      !hasWrittenVoicing(before, first, auxiliary.span.fromTick) ||
      !hasWrittenVoicing(neighbor, middle, returning.span.fromTick) ||
      !hasWrittenVoicing(arrival, last, returning.span.toTick)) return false;

  const bass = before.notes.bass!;
  if (bass.id !== neighbor.notes.bass!.id || bass.id !== arrival.notes.bass!.id) return false;

  let heldUpper = 0;
  for (const voice of ["soprano", "alto", "tenor"] as const) {
    const old = before.notes[voice]!, changed = neighbor.notes[voice]!, next = arrival.notes[voice]!;
    if (old.id === changed.id && changed.id === next.id) {
      heldUpper++;
      continue;
    }
    if (changed.startTick !== neighbor.tick || next.startTick !== arrival.tick ||
        !returnsByWrittenStep(old, changed, next) || writtenInterval(old.pitch, changed.pitch).diatonicSteps !== 1) {
      return false;
    }
  }
  return heldUpper === 1;
}
