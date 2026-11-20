import { chordToneSpellings, type KeyReference } from "../../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { resolvesInVoice, matchesWrittenChord } from "../../writtenResolution";

function agreesWithDegree(rules: HarmonyRuleContext, slice: AnalysisSlice, key: KeyReference, expected: number) {
  if (!slice.chord) return true;
  const reading = rules.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved") return reading.status !== "ambiguous";
  const { degree, degreeAlteration, appliedTarget, localKey } = reading.value;
  return !appliedTarget && degreeAlteration === 0 && degree === expected &&
    (!localKey || (localKey.mode === key.mode && pitchClassEquals(localKey.tonic, key.tonic)));
}

function confirmsMajorTarget(rules: HarmonyRuleContext, arrival: AnalysisSlice, key: KeyReference) {
  if (arrival.key.mode === key.mode && pitchClassEquals(arrival.key.tonic, key.tonic)) return true;
  // For a new local key require an independent, literal V7–I or V7–I6
  // after the six-four, with both tendency tones resolved in their voices.
  const dominant = rules.sliceAt(arrival.endTick);
  const tonic = dominant && rules.sliceAt(dominant.endTick);
  const root = scaleDegreePitchClass(key, 5);
  if (!dominant || !tonic?.notes.bass || dominant.key.id !== arrival.key.id || tonic.key.id !== arrival.key.id ||
      rules.analysis.phraseBoundaries.some(b => !b.stale && arrival.tick < b.tick && b.tick <= tonic.tick) ||
      !agreesWithDegree(rules, dominant, key, 5) || !agreesWithDegree(rules, tonic, key, 1) ||
      !matchesWrittenChord(dominant, root, "dominant7") || !matchesWrittenChord(tonic, key.tonic, "major") ||
      ![key.tonic, scaleDegreePitchClass(key, 3)].some(t => pitchClassEquals(t, tonic.notes.bass!.pitch))) return false;
  const tones = chordToneSpellings(root, "dominant7");
  const leading = VOICE_ORDER.find(v => pitchClassEquals(dominant.notes[v]!.pitch, leadingTonePitchClass(key)))!;
  const seventh = VOICE_ORDER.find(v => pitchClassEquals(dominant.notes[v]!.pitch, tones[3]))!;
  return resolvesInVoice(dominant, tonic, leading, key.tonic, 1) &&
    resolvesInVoice(dominant, tonic, seventh, scaleDegreePitchClass(key, 3), -1);
}

// §21.1,3,4 (ex. 21-283, 285): in major, the lowered fifth and the
// seventh of iiø7 descend in their own voices into the dominant.
function resolvesLoweredFifthToDominant(
  rules: HarmonyRuleContext,
  before: AnalysisSlice,
  middle: AnalysisSlice,
  target: AnalysisSlice,
  motion: MelodyTransition,
) {
  const key = middle.key;
  if (key.mode !== "major" || before.key.id !== key.id || target.key.id !== key.id) return false;
  const sixth = scaleDegreePitchClass(key, 6);
  if (!pitchClassEquals(motion.previous.pitch, sixth) ||
      !pitchClassEquals(motion.current.pitch, scaleDegreePitchClass(key, 6, -1)) ||
      Object.values(before.notes).filter(note => pitchClassEquals(note.pitch, sixth)).length !== 1) return false;

  const supertonic = scaleDegreePitchClass(key, 2);
  const dominant = scaleDegreePitchClass(key, 5);
  if ((!matchesWrittenChord(before, supertonic, "minor") && !matchesWrittenChord(before, supertonic, "minor7")) ||
      !matchesWrittenChord(middle, supertonic, "halfDiminished7") ||
      (!matchesWrittenChord(target, dominant, "major") && !matchesWrittenChord(target, dominant, "dominant7")) ||
      !agreesWithDegree(rules, before, key, 2) || !agreesWithDegree(rules, middle, key, 2) ||
      !agreesWithDegree(rules, target, key, 5) ||
      !resolvesInVoice(middle, target, motion.voiceId, dominant, -1)) return false;

  const seventh = VOICE_ORDER.find(voice => pitchClassEquals(middle.notes[voice]!.pitch, key.tonic))!;
  return resolvesInVoice(middle, target, seventh, leadingTonePitchClass(key), -1);
}

// §21.1,3,5 (ex. 21-283, 286): vi can prepare the half-diminished
// supertonic of harmonic major. Its seventh stays at the same written pitch
// while the bass fifth descends to the bass of the tonic six-four.
export function resolvesLoweredSupertonicFifth(rules: HarmonyRuleContext, motion: MelodyTransition) {
  const { voiceId, previous, current } = motion;
  const start = current.startTick, end = start + current.durationTicks;
  const before = rules.sliceAt(start - 1), middle = rules.sliceAt(start), target = rules.sliceAt(end);
  const next = target?.notes[voiceId];
  if (!before || !middle || !target || !next || before.notes[voiceId]?.id !== previous.id ||
      middle.notes[voiceId]?.id !== current.id || middle.tick !== start || middle.endTick !== end ||
      next.startTick !== end || !motion.sameKey || before.key.id !== target.key.id ||
      rules.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end)) return false;
  const step = writtenInterval(current.pitch, next.pitch);
  if (step.diatonicSteps !== -1 || step.semitones !== -1) return false;
  if (resolvesLoweredFifthToDominant(rules, before, middle, target, motion)) return true;
  if (voiceId !== "bass") return false;

  const bass = next;
  const key = { tonic: scaleDegreePitchClass({ tonic: bass.pitch, mode: "major" }, 4), mode: "major" } as const;
  const sixth = scaleDegreePitchClass(key, 6);
  if (!pitchClassEquals(previous.pitch, sixth) || !pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 6, -1)) ||
      !matchesWrittenChord(before, sixth, "minor") || !matchesWrittenChord(middle, scaleDegreePitchClass(key, 2), "halfDiminished7") ||
      !matchesWrittenChord(target, key.tonic, "major")) return false;
  if (!agreesWithDegree(rules, middle, key, 2) || !agreesWithDegree(rules, target, key, 1)) return false;
  const seventh = VOICE_ORDER.find(v => pitchClassEquals(middle.notes[v]!.pitch, key.tonic))!;
  return spelledPitchEquals(middle.notes[seventh]!.pitch, target.notes[seventh]!.pitch) &&
    confirmsMajorTarget(rules, target, key);
}
