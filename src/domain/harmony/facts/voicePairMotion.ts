import { toMidi, writtenInterval, type WrittenInterval } from "../../pitch";
import type { AnalysisNote } from "../analysis";

export type MotionDirection = "up" | "down" | "stationary";

function motion(
  previous: AnalysisNote,
  current: AnalysisNote,
): MotionDirection {
  const difference = toMidi(current.pitch) - toMidi(previous.pitch);
  return difference > 0 ? "up" : difference < 0 ? "down" : "stationary";
}

/** Vertical intervals are signed from the first voice to the second in both frames. */
export function observeVoicePairMotion(
  previousFirst: AnalysisNote, previousSecond: AnalysisNote,
  currentFirst: AnalysisNote, currentSecond: AnalysisNote,
) {
  return {
    previousInterval: writtenInterval(previousFirst.pitch, previousSecond.pitch),
    currentInterval: writtenInterval(currentFirst.pitch, currentSecond.pitch),
    firstMotion: motion(previousFirst, currentFirst),
    secondMotion: motion(previousSecond, currentSecond),
  };
}

export function writtenPerfectClass(interval: WrittenInterval) {
  const steps = Math.abs(interval.diatonicSteps) % 7;
  const semitones = Math.abs(interval.semitones) % 12;
  return steps === 4 && semitones === 7 ? 5 : steps === 0 && semitones === 0 ? 8 : 0;
}
