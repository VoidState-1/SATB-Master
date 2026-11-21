import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { hasWrittenVoicing, matchesWrittenChord, resolvesLeadingSeventhToDoubledThird } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { leadingToneForFunction } from "../services/harmony";

function allowsWrittenSource(
  context: HarmonyRuleContext, slice: AnalysisSlice, writtenRoot: SpelledPitchClass,
) {
  const chord = slice.chord;
  if (!chord) return true;
  if (chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return false;
  const readings = chord.semantics?.interpretations;
  if (!chord.locked && !context.analysis.project.chordTrack.locked &&
      readings?.length && readings.every(reading => reading.source === "inferred")) return true;

  if (!matchesWrittenChord(slice, writtenRoot, "diminished7")) return false;
  const explicit = context.harmony.primaryInterpretation(chord);
  return explicit.status === "unavailable" || (explicit.status === "resolved" &&
    pitchClassEquals(leadingToneForFunction(slice.key, explicit.value).tone, writtenRoot));
}

/** §22.3 and §28.6: the dominant can receive the doubled third of its own
 * local tonic from a fully resolved applied leading-tone seventh. */
export function receivesDoubledLocalTonicThird(
  context: HarmonyRuleContext, slice: AnalysisSlice, tone: SpelledPitchClass,
) {
  const chord = slice.chord;
  const bass = slice.notes.bass;
  if (!chord || !bass || chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 5 || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? slice.key;
  const tonic = scaleDegreePitchClass(key, 5);
  const tonicTones = chordToneSpellings(tonic, "major");
  if (!pitchClassEquals(tonicTones[1], tone) || !matchesWrittenChord(slice, tonic, "major")) return false;

  const arrival = context.sliceAt(bass.startTick);
  const before = context.sliceAt(bass.startTick - 1);
  if (arrival?.chord?.id !== chord.id || !before || before.endTick !== bass.startTick ||
      !keyEquals(before.key, slice.key) || crossesManualPhraseBoundary(context, before.tick, slice.tick)) return false;

  const lead = leadingTonePitchClass({ tonic, mode: "major" });
  const tones = chordToneSpellings(lead, "diminished7");
  return hasWrittenVoicing(before, tones) && allowsWrittenSource(context, before, lead) &&
    resolvesLeadingSeventhToDoubledThird(before, slice, tones, tonicTones);
}
