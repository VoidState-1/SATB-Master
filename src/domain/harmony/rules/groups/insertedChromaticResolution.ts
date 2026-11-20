import { pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { AnalysisNote, AnalysisSlice, MelodyTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

const upperVoices = ["soprano", "alto", "tenor"] as const;

function isInsertedStep(left: AnalysisNote, middle: AnalysisNote, right: AnalysisNote, direction: number) {
  const entry = writtenInterval(left.pitch, middle.pitch);
  const exit = writtenInterval(middle.pitch, right.pitch);
  return left.startTick + left.durationTicks === middle.startTick &&
    middle.startTick + middle.durationTicks === right.startTick &&
    entry.diatonicSteps === 0 && entry.semitones === direction &&
    exit.diatonicSteps === direction && exit.semitones === direction &&
    (!left.nonChordToneRole || left.nonChordToneRole === (direction < 0 ? "suspension" : "retardation")) &&
    (!middle.nonChordToneRole || middle.nonChordToneRole === "passing") && !right.nonChordToneRole;
}

function soundsTertian(frame: AnalysisSlice) {
  const bass = frame.notes.bass;
  if (!frame.completeSatb || !bass) return false;
  const pitches = Object.values(frame.notes).map(note => note.pitch);
  return pitches.every(pitch => toMidi(pitch) >= toMidi(bass.pitch)) && hasCompleteWrittenTertianVoicing(pitches);
}

function hasWrittenArrival(landing: AnalysisSlice, bass: AnalysisNote) {
  if (!soundsTertian(landing)) return false;
  const landedBass = landing.notes.bass!;
  if (landedBass.nonChordToneRole && landedBass.nonChordToneRole !== "pedal") return false;
  if (spelledPitchEquals(landedBass.pitch, bass.pitch)) return true;

  // A bass descent can add the written seventh at the moment of resolution.
  const step = writtenInterval(bass.pitch, landedBass.pitch);
  const upper = upperVoices.map(voice => landing.notes[voice]!.pitch);
  return step.diatonicSteps === -1 && (step.semitones === -1 || step.semitones === -2) &&
    upper.some(pitch => pitchClassEquals(pitch, bass.pitch)) &&
    upper.every(pitch => !pitchClassEquals(pitch, landedBass.pitch)) &&
    hasCompleteWrittenTertianVoicing(upper);
}

function areParallelThirdsOrSixths(lower: VoiceId, upper: VoiceId, frames: readonly AnalysisSlice[]) {
  const intervals = frames.map(frame => writtenInterval(frame.notes[lower]!.pitch, frame.notes[upper]!.pitch));
  const first = intervals[0];
  return first.semitones > 0 && [2, 5].includes(first.diatonicSteps % 7) &&
    intervals.every(interval => interval.diatonicSteps === first.diatonicSteps && interval.semitones === first.semitones);
}

/** §45.2b: the chromatic insertion continues a prepared whole-tone resolution. */
export function hasInsertedChromaticResolution(
  context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition,
) {
  const { voiceId, previous: left, current: middle, writtenInterval: entry } = first;
  const right = second.current;
  if (voiceId === "bass" || entry.diatonicSteps !== 0 || Math.abs(entry.semitones) !== 1 ||
      middle.id !== second.previous.id || !isInsertedStep(left, middle, right, entry.semitones)) return false;

  const from = context.sliceAt(middle.startTick - 1);
  const via = context.sliceAt(middle.startTick);
  const landing = context.sliceAt(right.startTick);
  const bass = from?.notes.bass;
  if (!from?.completeSatb || !via?.completeSatb || !landing?.completeSatb || !bass ||
      (bass.nonChordToneRole && bass.nonChordToneRole !== "pedal") ||
      bass.startTick >= middle.startTick || !hasWrittenArrival(landing, bass)) return false;

  const onset = context.sliceAt(bass.startTick);
  const preparation = context.sliceAt(bass.startTick - 1);
  const oldBass = preparation?.notes.bass;
  if (!onset?.completeSatb || !oldBass || spelledPitchEquals(oldBass.pitch, bass.pitch) ||
      context.metric.compare(context.metric.positionAt(bass.startTick), context.metric.positionAt(middle.startTick)) !== "stronger") return false;

  const moving = upperVoices.filter(voice => from.notes[voice]!.id !== via.notes[voice]!.id);
  if (!moving.includes(voiceId) || moving.length > 2) return false;
  // A single prepared ninth resolving to the bass's pitch class already has
  // dedicated cadence, spelling, and bass-continuity checks in chromaticPassing.
  if (moving.length === 1 && entry.semitones < 0 && pitchClassEquals(right.pitch, bass.pitch)) return false;
  if (moving.length === 2 && !areParallelThirdsOrSixths(moving[1], moving[0], [from, via, landing])) return false;
  const fixed = upperVoices.filter(voice => !moving.includes(voice));
  if (!fixed.every(voice => !from.notes[voice]!.nonChordToneRole && !landing.notes[voice]!.nonChordToneRole &&
      spelledPitchEquals(from.notes[voice]!.pitch, landing.notes[voice]!.pitch))) return false;

  const arrivalPitches = Object.values(landing.notes).map(note => note.pitch);
  if (!moving.every(voice => {
    const initial = from.notes[voice]!, inserted = via.notes[voice]!, resolved = landing.notes[voice]!;
    return initial.startTick <= bass.startTick && onset.notes[voice]?.id === initial.id &&
      inserted.startTick === middle.startTick && resolved.startTick === right.startTick &&
      isInsertedStep(initial, inserted, resolved, entry.semitones) &&
      !arrivalPitches.some(pitch => pitchClassEquals(pitch, initial.pitch) || pitchClassEquals(pitch, inserted.pitch));
  })) return false;

  const motion = context.slices({ overlapping: { fromTick: bass.startTick, toTick: right.startTick } });
  if (!motion.all(slice => slice.notes.bass?.id === bass.id && slice.key.id === landing.key.id &&
      upperVoices.every(voice => {
        const expected = slice.tick < middle.startTick ? from.notes[voice]! : via.notes[voice]!;
        return slice.notes[voice]?.id === expected.id && toMidi(expected.pitch) >= toMidi(bass.pitch);
      }))) return false;

  // In 45-661 the upper voice can leave a complete preparation just
  // before the next bass attack. Look back only under the same old bass
  // and while the prepared voice(s) still sound at the same pitch.
  const candidates = context.slices({ overlapping: { fromTick: oldBass.startTick, toTick: bass.startTick } }).toArray();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const slice = candidates[index];
    if (slice.key.id !== landing.key.id || slice.notes.bass?.id !== oldBass.id ||
        !moving.every(voice => {
          const note = slice.notes[voice];
          return note && spelledPitchEquals(note.pitch, from.notes[voice]!.pitch);
        }) || context.analysis.project.structure.phraseBoundaries.some(boundary =>
          boundary.source === "manual" && !boundary.stale && slice.tick < boundary.tick && boundary.tick <= landing.tick)) return false;
    if (soundsTertian(slice)) return true;
  }
  return false;
}
