import { chordToneSpellings, type KeyReference } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import { hasWrittenVoicing, resolvesInVoice } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreesWithExplicitIdentity } from "./maskedChordSpelling";
import { crossesWrittenBoundary, keepsWrittenMember, resolvesMaskedStep } from "./maskedContinuation";

export function respeltDegrees(key: KeyReference) {
  return {
    tonic: key.tonic,
    tonicThird: scaleDegreePitchClass(key, 3),
    raisedSecond: scaleDegreePitchClass(key, 2, 1),
    raisedFourth: scaleDegreePitchClass(key, 4, 1),
    sixth: scaleDegreePitchClass(key, 6),
    dominant: scaleDegreePitchClass(key, 5),
  };
}

// Spasobin §28.2: before K64, the seventh of root-position or first-inversion
// DDvii°7 can be written as ♯II to show its upward resolution to III.
export function writtenDoubleDominantResolution(source: AnalysisSlice, target: AnalysisSlice, key: KeyReference) {
  if (key.mode !== "major" || !source.completeSatb || !target.completeSatb || source.endTick !== target.tick) return;
  const { tonic, tonicThird, raisedSecond, raisedFourth, sixth, dominant } = respeltDegrees(key);
  const bass = source.notes.bass!.pitch;
  if ((!pitchClassEquals(bass, raisedFourth) && !pitchClassEquals(bass, sixth)) ||
      !pitchClassEquals(target.notes.bass!.pitch, dominant)) return;

  const loweredThird = scaleDegreePitchClass(key, 3, -1);
  const voiceId = VOICE_ORDER.find(voice => {
    const pitch = source.notes[voice]!.pitch;
    return pitchClassEquals(pitch, loweredThird) || pitchClassEquals(pitch, raisedSecond);
  });
  if (!voiceId || !hasWrittenVoicing(source, [raisedFourth, sixth, tonic, source.notes[voiceId]!.pitch]) ||
      !hasWrittenVoicing(target, [tonic, tonicThird, dominant]) ||
      !resolvesMaskedStep(source, target, voiceId, raisedSecond, tonicThird, 1)) return;

  for (const voice of VOICE_ORDER) {
    if (voice === voiceId) continue;
    const pitch = source.notes[voice]!.pitch;
    if (pitchClassEquals(pitch, tonic)) {
      if (!keepsWrittenMember(source, target, voice)) return;
    } else if (!resolvesInVoice(source, target, voice, dominant, pitchClassEquals(pitch, raisedFourth) ? 1 : -1)) return;
  }
  return { voiceId, previous: raisedSecond, current: tonicThird };
}

export function readDoubleDominantResolution(context: HarmonyRuleContext, source: AnalysisSlice, target: AnalysisSlice) {
  const role = target.chord?.semantics?.cadenceRole;
  if (role && role !== "cadential64") return;
  const sourceReading = source.chord && context.harmony.primaryInterpretation(source.chord);
  const targetReading = target.chord && context.harmony.primaryInterpretation(target.chord);
  const sourceKey = sourceReading?.status === "resolved" ? sourceReading.value.localKey : undefined;
  const targetKey = targetReading?.status === "resolved" ? targetReading.value.localKey : undefined;
  if (sourceKey && targetKey && !keyEquals(sourceKey, targetKey)) return;
  const key = targetKey ?? sourceKey ?? source.key;
  const resolution = writtenDoubleDominantResolution(source, target, key);
  if (!resolution || crossesWrittenBoundary(context, source.notes[resolution.voiceId]!.startTick, target.tick)) return;

  // The declared diminished seventh retains its tertian identity even when
  // the score uses the enharmonic ♯II. Check both labels against that reading.
  const root = scaleDegreePitchClass(key, 4, 1);
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (agreesWithExplicitIdentity(source, resolution.voiceId,
    { root, quality: "diminished7", member: chordToneSpellings(root, "diminished7")[3] }, trackLocked) &&
    agreesWithExplicitIdentity(target, resolution.voiceId,
      { root: key.tonic, quality: "major", member: resolution.current }, trackLocked)) return resolution;
}
