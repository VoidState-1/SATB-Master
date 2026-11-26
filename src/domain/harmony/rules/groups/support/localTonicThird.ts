import { chordToneSpellings } from "../../../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../../pitch";
import { VOICE_ORDER } from "../../../../project/voice";
import type { AnalysisSlice } from "../../../analysis";
import { returnsByWrittenStep } from "../../../facts/prolongation";
import { allowsWrittenTertianIdentity, leadingSeventhMemberResolves, matchesWrittenChord } from "../../../facts/tendencyResolution";
import { soundsWrittenMemberSet } from "../../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../../helpers/core";
import { leadingToneForFunction } from "../../services/harmony";

function allowsWrittenSource(context: HarmonyRuleContext, slice: AnalysisSlice,
  root: SpelledPitchClass, quality: "diminished7" | "halfDiminished7") {
  const chord = slice.chord;
  if (!chord) return true;
  if (chord.semantics?.pedalContext || chord.semantics?.cadenceRole) return false;
  const readings = chord.semantics?.interpretations;
  if (!chord.locked && !context.analysis.project.chordTrack.locked &&
      readings?.length && readings.every(reading => reading.source === "inferred")) return true;
  if (!allowsWrittenTertianIdentity(slice, root, quality)) return false;
  const explicit = context.harmony.primaryInterpretation(chord);
  return explicit.status === "unavailable" || (explicit.status === "resolved" &&
    pitchClassEquals(leadingToneForFunction(slice.key, explicit.value).tone, root));
}

/** §22.3 and §28.6. The third of a tonicized dominant can be doubled when
 * its own leading seventh resolves. Trace each of the four actual notes,
 * including a prepared part which releases after the bass arrives. */
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

  const entry = context.sliceAt(bass.startTick);
  const before = context.sliceAt(bass.startTick - 1);
  if (entry?.chord?.id !== chord.id || !before?.completeSatb || before.endTick !== entry.tick ||
      !keyEquals(before.key, slice.key) || crossesManualPhraseBoundary(context, before.tick, slice.tick)) return false;
  const root = leadingTonePitchClass({ tonic, mode: "major" });
  return (["diminished7", "halfDiminished7"] as const).some(quality => {
    const tones = chordToneSpellings(root, quality);
    if (!soundsWrittenMemberSet(before, tones) || !allowsWrittenSource(context, before, root, quality)) return false;
    return VOICE_ORDER.every(voice => {
      const from = before.notes[voice]!;
      const tick = from.startTick + from.durationTicks;
      if (tick > slice.tick) return false;
      const landing = context.sliceAt(tick);
      const to = landing?.notes[voice];
      if (!to || landing?.chord?.id !== chord.id || to.startTick !== tick || to.nonChordToneRole ||
          !leadingSeventhMemberResolves(from.pitch, to.pitch, tones, tonicTones)) return false;
      if (tick > entry.tick) {
        const role = tones.slice(0, 2).some(t => pitchClassEquals(t, from.pitch)) ? "retardation" : "suspension";
        if (entry.notes[voice]?.id !== from.id || (from.nonChordToneRole && from.nonChordToneRole !== role)) return false;
      } else if (from.nonChordToneRole) return false;
      const current = slice.notes[voice]!;
      if (current.id === to.id) return true;
      const neighbor = context.sliceAt(to.startTick + to.durationTicks)?.notes[voice];
      return !!neighbor && returnsByWrittenStep(to, neighbor, current);
    });
  });
}
