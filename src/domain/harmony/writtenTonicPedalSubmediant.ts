import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi } from "../pitch";
import type { PhraseBoundary } from "../project/types";
import type { AnalysisSlice } from "./analysis";

/** Spasobin §50, example 50-757: I and ♭VI over a sounding tonic pedal. */
export function readWrittenTonicPedalSubmediant(
  before: AnalysisSlice, after: AnalysisSlice, boundaries: readonly PhraseBoundary[],
) {
  const { key, tick } = after;
  const from = before.notes;
  const to = after.notes;
  if (before.endTick !== tick || before.key.id !== key.id || key.mode !== "major" ||
      !from.bass || !to.bass || from.bass.id !== to.bass.id ||
      !pitchClassEquals(to.bass.pitch, key.tonic) ||
      !from.soprano || !to.soprano || !pitchClassEquals(to.soprano.pitch, key.tonic) ||
      !spelledPitchEquals(from.soprano.pitch, to.soprano.pitch) ||
      !from.alto || !from.tenor || !to.alto || !to.tenor) return;

  // The named bass must be the actual lowest pitch. Its pedal role is compatible
  // with both sonorities, but upper voices marked as decorations cannot prove them.
  const bassMidi = toMidi(to.bass.pitch);
  if ((to.bass.nonChordToneRole && to.bass.nonChordToneRole !== "pedal") ||
      [from.soprano, from.alto, from.tenor, to.soprano, to.alto, to.tenor].some(note =>
        note.nonChordToneRole || toMidi(note.pitch) < bassMidi)) return;

  const third = scaleDegreePitchClass(key, 3);
  const loweredThird = scaleDegreePitchClass(key, 3, -1);
  const fifth = scaleDegreePitchClass(key, 5);
  const loweredSixth = scaleDegreePitchClass(key, 6, -1);
  const altoHasThird = pitchClassEquals(from.alto.pitch, third) || pitchClassEquals(from.alto.pitch, loweredThird);
  const thirdVoice = altoHasThird ? "alto" : "tenor";
  const fromThird = altoHasThird ? from.alto : from.tenor;
  const toThird = altoHasThird ? to.alto : to.tenor;
  const fromCompanion = altoHasThird ? from.tenor : from.alto;
  const toCompanion = altoHasThird ? to.tenor : to.alto;

  const departure = Math.min(fromThird.startTick, fromCompanion.startTick);
  if (boundaries.some(boundary => boundary.source === "manual" && !boundary.stale &&
      departure < boundary.tick && boundary.tick <= tick)) return;

  const entersSubmediant = pitchClassEquals(fromThird.pitch, third);
  const semitones = entersSubmediant ? -1 : 1;
  if (!pitchClassEquals(fromThird.pitch, entersSubmediant ? third : loweredThird) ||
      !pitchClassEquals(toThird.pitch, entersSubmediant ? loweredThird : third) ||
      !pitchClassEquals(fromCompanion.pitch, entersSubmediant ? fifth : loweredSixth) ||
      !pitchClassEquals(toCompanion.pitch, entersSubmediant ? loweredSixth : fifth) ||
      fromThird.startTick + fromThird.durationTicks !== tick || toThird.startTick !== tick ||
      fromCompanion.startTick + fromCompanion.durationTicks !== tick || toCompanion.startTick !== tick ||
      toMidi(toThird.pitch) - toMidi(fromThird.pitch) !== semitones ||
      toMidi(toCompanion.pitch) - toMidi(fromCompanion.pitch) !== -semitones) return;

  const direction = entersSubmediant ? "to-flat-submediant" : "to-tonic";
  return { direction, thirdVoice, fromThird, toThird };
}
