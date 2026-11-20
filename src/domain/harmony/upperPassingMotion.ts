import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, stepIndex, toMidi, writtenInterval } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import { compareMetricStrength, type MetricPosition } from "../rhythm/metric";
import type { AnalysisSlice } from "./analysis";
import { hasCompleteWrittenTertianVoicing } from "./writtenTertian";

interface PassingFrame {
  fromTick: number;
  toTick: number;
  key: AnalysisSlice["key"];
  activeNotes: AnalysisSlice["notes"];
  metric?: MetricPosition;
}

// Spasobin §38.1–4. Follow one written line from chord tone to chord tone;
// at the intervening weak attack all three other note events must still sound.
export function upperPassingMotion(left: PassingFrame, middle: PassingFrame, right: PassingFrame, ppq: number) {
  if (left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
      middle.metric?.confidence !== "certain" || middle.metric.level >= 2 ||
      right.metric?.confidence !== "certain" ||
      compareMetricStrength(left.metric, middle.metric) !== "stronger" ||
      compareMetricStrength(right.metric, middle.metric) === "weaker") return;
  for (const frame of [left, middle, right]) {
    const bass = frame.activeNotes.bass;
    if (!bass || frame.key.id !== middle.key.id || frame.key.mode !== middle.key.mode ||
        !pitchClassEquals(frame.key.tonic, middle.key.tonic)) return;
    for (const voice of VOICE_ORDER) {
      const note = frame.activeNotes[voice];
      if (!note || toMidi(note.pitch) < toMidi(bass.pitch)) return;
    }
  }
  const attacks = VOICE_ORDER.filter(voice => middle.activeNotes[voice]!.startTick === middle.fromTick);
  if (attacks.length !== 1 || attacks[0] === "bass") return;
  const voice = attacks[0];
  if (VOICE_ORDER.some(v => v !== voice && (middle.activeNotes[v]!.id !== left.activeNotes[v]!.id ||
      middle.activeNotes[v]!.nonChordToneRole))) return;
  const before = left.activeNotes[voice]!, note = middle.activeNotes[voice]!, after = right.activeNotes[voice]!;
  if (before.nonChordToneRole || after.nonChordToneRole || (note.nonChordToneRole && note.nonChordToneRole !== "passing") ||
      before.startTick !== left.fromTick || before.startTick + before.durationTicks !== note.startTick ||
      note.startTick + note.durationTicks !== right.fromTick || after.startTick !== right.fromTick ||
      note.durationTicks > ppq || note.durationTicks > before.durationTicks) return;
  const into = writtenInterval(before.pitch, note.pitch), out = writtenInterval(note.pitch, after.pitch);
  const degree = (stepIndex(note.pitch.step) - stepIndex(middle.key.tonic.step) + 7) % 7 + 1;
  if (!isWrittenStep(into) || !isWrittenStep(out) || into.diatonicSteps !== out.diatonicSteps ||
      Math.sign(into.semitones) !== into.diatonicSteps || Math.sign(out.semitones) !== out.diatonicSteps ||
      !pitchClassEquals(note.pitch, scaleDegreePitchClass(middle.key, degree)) ||
      hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(v => middle.activeNotes[v]!.pitch))) return;
  return { note, after };
}
