import { chordToneSpellings, type KeyReference } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../../pitch";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasWrittenVoicing } from "../state/doubleDominantSeventh";
import { cadentialSixFourInKey } from "./chromaticDoubleDominant";

function subdominantSixth(
  rules: HarmonyRuleContext, slice: AnalysisSlice, key: KeyReference, lowered: boolean,
) {
  if (!slice.chord || !slice.notes.bass) return;
  const reading = rules.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved") return;
  const value = reading.value;
  const localKey = value.localKey ?? slice.key;
  const degree = value.degree;
  if (value.appliedTarget || value.degreeAlteration !== 0 || (degree !== 2 && degree !== 4) ||
      value.designation?.primaryFunction !== "subdominant" ||
      localKey.mode !== key.mode || !pitchClassEquals(localKey.tonic, key.tonic)) return;
  const quality = degree === 2 ? (lowered ? "diminished" : "minor") : (lowered ? "minor" : "major");
  const tones = chordToneSpellings(scaleDegreePitchClass(key, degree), quality);
  const { root, bass, structure } = slice.chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality || structure.extensions.length ||
      structure.alterations.length || !pitchClassEquals(root, tones[0]) || !pitchClassEquals(bass, tones[1]) ||
      !pitchClassEquals(slice.notes.bass.pitch, bass) || !hasWrittenVoicing(slice, tones)) return;
  return degree;
}

// §19.1, §19.4: the same voice can lower VI within the subdominant group.
// Verify the natural and harmonic forms and the actual step into V of K64.
export function lowersSixthInSubdominant(rules: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || entry.diatonicSteps !== 0 || entry.semitones !== -1) return false;
  const tick = current.startTick;
  const end = tick + current.durationTicks;
  const from = rules.sliceAt(tick - 1), middle = rules.sliceAt(tick), landing = rules.sliceAt(end);
  if (!from || !middle || !landing?.chord || from.notes[voiceId]?.id !== previous.id ||
      middle.tick !== tick || middle.endTick !== end || middle.chord?.startTick !== tick ||
      landing.chord.startTick !== end || landing.notes[voiceId]?.startTick !== end ||
      from.key.id !== middle.key.id || middle.key.id !== landing.key.id ||
      rules.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end)) return false;
  const reading = rules.harmony.primaryInterpretation(landing.chord);
  if (reading.status !== "resolved" || reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? landing.key;
  if (key.mode !== "major" || !cadentialSixFourInKey(rules, landing, key) ||
      !hasWrittenVoicing(landing, chordToneSpellings(key.tonic, "major"))) return false;
  const sixth = scaleDegreePitchClass(key, 6);
  const flatSixth = scaleDegreePitchClass(key, 6, -1);
  const next = landing.notes[voiceId];
  if (!next || !pitchClassEquals(previous.pitch, sixth) || !pitchClassEquals(current.pitch, flatSixth) ||
      !pitchClassEquals(next.pitch, scaleDegreePitchClass(key, 5)) || writtenInterval(current.pitch, next.pitch).semitones !== -1 ||
      Object.values(from.notes).filter(n => pitchClassEquals(n.pitch, sixth)).length !== 1 ||
      Object.values(middle.notes).filter(n => pitchClassEquals(n.pitch, flatSixth)).length !== 1) return false;
  const source = subdominantSixth(rules, from, key, false);
  return source !== undefined && source === subdominantSixth(rules, middle, key, true);
}
