import { isWrittenStep, keyDeclarationEquals, spelledPitchEquals, writtenInterval, type SpelledPitch } from "../../pitch";
import type { AnalysisSlice } from "../analysis";
import { soundsDeclaredChord } from "./writtenVoicing";

export function continuousPassingBass(before: SpelledPitch, first: SpelledPitch, last: SpelledPitch, after: SpelledPitch) {
  if (!spelledPitchEquals(first, last)) return false;
  const into = writtenInterval(before, first), out = writtenInterval(last, after);
  const step = (i: typeof into) => isWrittenStep(i) && Math.sign(i.semitones) === i.diatonicSteps ||
    (i.diatonicSteps === 0 && Math.abs(i.semitones) === 1);
  return step(into) && step(out) && Math.sign(into.semitones) === Math.sign(out.semitones);
}

/** A complete doubled-bass six-four has an independent passing witness
 * when an upper part traverses the opposite written third at the same time. */
export function contraryPassingSixFour(before: AnalysisSlice, middle: AnalysisSlice, after: AnalysisSlice) {
  if (before.endTick !== middle.tick || middle.endTick !== after.tick ||
      ![before, middle, after].every(s => soundsDeclaredChord(s) && keyDeclarationEquals(s.key, middle.key))) return false;
  const bass = middle.notes.bass!.pitch;
  if (!continuousPassingBass(before.notes.bass!.pitch, bass, bass, after.notes.bass!.pitch)) return false;
  const direction = Math.sign(writtenInterval(before.notes.bass!.pitch, bass).semitones);
  return (["soprano", "alto", "tenor"] as const).some(voice => {
    const a = before.notes[voice]!.pitch, b = middle.notes[voice]!.pitch, c = after.notes[voice]!.pitch;
    return continuousPassingBass(a, b, b, c) && writtenInterval(a, b).diatonicSteps === -direction &&
      writtenInterval(b, c).diatonicSteps === -direction;
  });
}
