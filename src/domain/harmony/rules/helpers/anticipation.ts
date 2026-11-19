import { chordIdentityToneSpellings } from "../../../chordModel";
import { isWrittenStep, pitchClassEquals, writtenInterval } from "../../../pitch";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "./core";

/** Restore the previous structural note only in voices that demonstrably
 * anticipate the next chord (Spasobin, chapter 42, §§1–5). */
export function notesWithAnticipationReplacements(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  active = activeNotes(slice),
) {
  const chord = slice.chord;
  if (!chord || !slice.completeSatb) return active;
  const ornaments = active.filter(
    ({ note }) =>
      note.nonChordToneRole === "anticipation" &&
      !context.harmony.isWrittenChordTone(note, chord),
  );
  if (ornaments.length === 0 || ornaments.length > 2) return active;

  const onset = ornaments[0].note.startTick;
  const arrival = chord.startTick + chord.durationTicks;
  const duration = arrival - onset;
  if (
    onset <= chord.startTick ||
    duration <= 0 ||
    duration > context.analysis.project.ppq / 2 ||
    ornaments.some(({ note }) => note.startTick !== onset || note.durationTicks !== duration)
  ) return active;

  const before = context.sliceAt(onset - 1);
  const after = context.sliceAt(arrival);
  const target = after?.chord;
  if (
    !before?.completeSatb ||
    before.chord?.id !== chord.id ||
    !after?.completeSatb ||
    !target ||
    target.startTick !== arrival ||
    !pitchClassEquals(before.notes.bass!.pitch, chord.identity.bass) ||
    !pitchClassEquals(after.notes.bass!.pitch, target.identity.bass)
  ) return active;

  const weak = context.metric.positionAt(onset);
  if (
    (weak?.role !== "weak-beat" && weak?.role !== "subdivision") ||
    context.metric.compare(weak, context.metric.positionAt(arrival)) !== "weaker"
  ) return active;

  const sourceNotes = activeNotes(before);
  if (
    sourceNotes.some(({ note }) => note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, chord)) ||
    !chordIdentityToneSpellings(chord.identity).every(tone =>
      sourceNotes.some(({ note }) => pitchClassEquals(note.pitch, tone)),
    ) ||
    activeNotes(after).some(({ note }) => note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, target))
  ) return active;

  const motions: Array<{
    ornament: (typeof ornaments)[number];
    previous: AnalysisNote;
    direction: number;
  }> = [];
  for (const ornament of ornaments) {
    const { voiceId, note } = ornament;
    const previous = before.notes[voiceId]!;
    const next = after.notes[voiceId]!;
    if (
      previous.startTick + previous.durationTicks !== onset ||
      next.startTick !== arrival ||
      duration > previous.durationTicks ||
      duration > next.durationTicks ||
      !context.pitch.sameWrittenPitch(note, next)
    ) return active;
    const entry = writtenInterval(previous.pitch, note.pitch);
    if (!isWrittenStep(entry) || Math.sign(entry.semitones) !== entry.diatonicSteps) return active;
    motions.push({ ornament, previous, direction: entry.diatonicSteps });
  }

  if (motions.length === 2 && motions[0].direction === motions[1].direction) {
    const [upper, lower] = motions;
    const sourceInterval = writtenInterval(lower.previous.pitch, upper.previous.pitch);
    const ornamentInterval = writtenInterval(lower.ornament.note.pitch, upper.ornament.note.pitch);
    const sourceClass = Math.abs(sourceInterval.diatonicSteps) % 7;
    const ornamentClass = Math.abs(ornamentInterval.diatonicSteps) % 7;
    if (sourceClass !== ornamentClass || (ornamentClass !== 2 && ornamentClass !== 5)) return active;
  }

  // Check the actual intervening voicing. Other voices can change chord tones,
  // but only the verified anticipations receive a replacement.
  for (const weakSlice of context.slices({ overlapping: { fromTick: onset, toTick: arrival } })) {
    if (
      !weakSlice.completeSatb ||
      weakSlice.chord?.id !== chord.id ||
      activeNotes(weakSlice).some(({ note }) =>
        !ornaments.some(ornament => ornament.note.id === note.id) &&
        (note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, chord)),
      )
    ) return active;
  }

  return active.map(item => {
    const motion = motions.find(({ ornament }) => ornament.voiceId === item.voiceId);
    return motion ? { voiceId: item.voiceId, note: motion.previous } : item;
  });
}
