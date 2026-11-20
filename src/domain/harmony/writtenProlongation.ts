import {
  chordIdentityEquals, type ChordIdentity,
} from "../chordModel";
import {
  keyDeclarationEquals,
  pitchClassEquals, spelledPitchEquals,
} from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { VoiceId } from "../project/types";
import type { AnalysisNote, AnalysisSlice } from "./analysis";
import { readSoundingTertianIdentity } from "./writtenVoicing";
import { returnsByWrittenStep } from "./writtenNeighbors";

type WrittenProlongationFrame = Pick<AnalysisSlice, "tick" | "endTick" | "key" | "notes" | "completeSatb">;

export interface WrittenProlongation {
  readonly departureTick: number;
  readonly fromTick: number;
  readonly returnTick: number;
  readonly anchorIdentity: ChordIdentity;
  readonly surfaceIdentity: ChordIdentity;
  readonly bass: AnalysisNote;
  readonly voices: readonly {
    readonly voice: VoiceId;
    readonly departure: AnalysisNote;
    readonly middle: AnalysisNote;
    readonly arrival: AnalysisNote;
    readonly motion: "common-tone" | "neighbor";
  }[];
}

/** Physical return and neighboring motions give a structural relation.
 * The written intermediate chord keeps its own members and bass. */
export function readWrittenProlongation(
  left: WrittenProlongationFrame | undefined,
  middle: WrittenProlongationFrame,
  right: WrittenProlongationFrame | undefined,
  boundaries: readonly number[],
): WrittenProlongation | undefined {
  const bass = middle.notes.bass;
  if (!left?.completeSatb || !right?.completeSatb || !middle.completeSatb || !bass ||
      left.endTick !== middle.tick || middle.endTick !== right.tick ||
      !keyDeclarationEquals(left.key, middle.key) || !keyDeclarationEquals(middle.key, right.key) ||
      boundaries.some(tick => left.tick < tick && tick <= right.tick)) return;

  const voices: Array<WrittenProlongation["voices"][number]> = [];
  for (const voice of VOICE_ORDER) {
    const departure = left.notes[voice], note = middle.notes[voice], arrival = right.notes[voice];
    if (!departure || !note || !arrival || departure.nonChordToneRole || note.nonChordToneRole ||
        arrival.nonChordToneRole || !spelledPitchEquals(departure.pitch, arrival.pitch)) return;
    const common = spelledPitchEquals(departure.pitch, note.pitch);
    if (!common) {
      if (note.startTick !== middle.tick || arrival.startTick !== right.tick ||
          !returnsByWrittenStep(departure, note, arrival)) return;
    }
    voices.push({ voice, departure, middle: note, arrival, motion: common ? "common-tone" : "neighbor" });
  }
  if (!voices.some(voice => voice.motion === "common-tone") ||
      !voices.some(voice => voice.motion === "neighbor")) return;

  const anchor = readSoundingTertianIdentity(left);
  if (!anchor || anchor.structure.kind !== "tertian" ||
      (anchor.structure.quality !== "major" && anchor.structure.quality !== "minor") ||
      !voices.some(voice => voice.motion === "common-tone" &&
        pitchClassEquals(voice.middle.pitch, anchor.root))) return;
  const arrival = readSoundingTertianIdentity(right);
  if (!arrival || !chordIdentityEquals(anchor, arrival)) return;
  const surface = readSoundingTertianIdentity(middle);
  if (!surface || surface.structure.kind !== "tertian" || surface.structure.quality !== "diminished7") return;

  return Object.freeze({
    departureTick: left.tick, fromTick: middle.tick, returnTick: right.tick,
    anchorIdentity: anchor, surfaceIdentity: surface, bass,
    voices: Object.freeze(voices.map(item => Object.freeze(item))),
  });
}

export function readSliceProlongations(
  slices: readonly AnalysisSlice[], boundaries: readonly number[],
): ReadonlyMap<number, WrittenProlongation> {
  const facts = new Map<number, WrittenProlongation>();
  for (let i = 1; i + 1 < slices.length; i++) {
    const fact = readWrittenProlongation(slices[i - 1], slices[i], slices[i + 1], boundaries);
    if (fact) facts.set(fact.fromTick, fact);
  }
  return facts;
}
