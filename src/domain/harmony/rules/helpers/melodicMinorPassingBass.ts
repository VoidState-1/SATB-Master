import { chordToneSpellings } from "../../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";

const upper = ["soprano", "alto", "tenor"] as const;

// In ascending melodic minor the bass may fill V–V6 (or V65) on its
// way to i. Locate the structural voicing from the held upper triad.
export function beforeMelodicMinorPassingBass(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const bass = middle.notes.bass, key = middle.key;
  if (!bass || bass.nonChordToneRole !== "passing" || key.mode !== "minor" ||
      bass.startTick !== middle.tick || bass.startTick + bass.durationTicks !== middle.endTick ||
      !middle.chord || middle.chord.startTick + middle.chord.durationTicks !== middle.endTick) return;
  const metric = context.metric.positionAt(middle.tick);
  if (metric?.confidence !== "certain" || (metric.role !== "weak-beat" && metric.role !== "subdivision") ||
      bass.durationTicks > context.analysis.project.ppq) return;

  const before = context.sliceAt(middle.tick - 1), leading = context.sliceAt(middle.endTick);
  const tonic = leading && context.sliceAt(leading.endTick);
  const initialBass = before?.notes.bass, leadingBass = leading?.notes.bass;
  if (!before || !initialBass || before.chord?.id !== middle.chord.id || !leading?.chord || !tonic?.chord ||
      !leadingBass || leadingBass.startTick !== leading.tick ||
      leadingBass.startTick + leadingBass.durationTicks !== leading.endTick ||
      leading.chord.startTick !== leading.tick || tonic.chord.startTick !== tonic.tick ||
      initialBass.startTick < middle.chord.startTick || initialBass.durationTicks < bass.durationTicks ||
      context.analysis.phraseBoundaries.some(b => !b.stale && initialBass.startTick < b.tick && b.tick <= tonic.tick)) return;
  for (const [frame, degree] of [[before, 5], [leading, 5], [tonic, 1]] as const) {
    if (frame.key.id !== key.id) return;
    const reading = context.harmony.primaryInterpretation(frame.chord!);
    if (reading.status === "ambiguous" || (reading.status === "resolved" &&
        (reading.value.degree !== degree || reading.value.degreeAlteration !== 0 || reading.value.appliedTarget ||
         (reading.value.localKey && (reading.value.localKey.mode !== key.mode ||
           !pitchClassEquals(reading.value.localKey.tonic, key.tonic)))))) return;
  }

  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(initialBass.pitch, dominant) || !matchesWrittenChord(before, dominant, "major") ||
      !movesToWrittenTone(initialBass.pitch, bass.pitch, scaleDegreePitchClass(key, 6, 1), 1, 2) ||
      !movesToWrittenTone(bass.pitch, leadingBass.pitch, leadingTonePitchClass(key), 1, 2) ||
      !resolvesInVoice(leading, tonic, "bass", key.tonic, 1) || !matchesWrittenChord(tonic, key.tonic, "minor")) return;

  const dominantTones = chordToneSpellings(dominant, "major");
  if (!dominantTones.every(tone => upper.some(v => pitchClassEquals(before.notes[v]!.pitch, tone))) ||
      !upper.every(v => middle.notes[v]?.id === before.notes[v]!.id &&
        toMidi(before.notes[v]!.pitch) >= toMidi(bass.pitch))) return;
  if (matchesWrittenChord(leading, dominant, "major")) return before;
  if (!matchesWrittenChord(leading, dominant, "dominant7")) return;
  const seventh = chordToneSpellings(dominant, "dominant7")[3];
  const voice = upper.find(v => pitchClassEquals(leading.notes[v]!.pitch, seventh));
  if (voice && resolvesInVoice(leading, tonic, voice, scaleDegreePitchClass(key, 3), -1)) return before;
}
