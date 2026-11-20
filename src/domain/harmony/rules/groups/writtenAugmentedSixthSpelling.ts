import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, pitchClassValue, scaleDegreePitchClass, toMidi } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreesWithExplicitIdentity, agreesWithExplicitMembers, completeVoicings } from "../helpers/maskedChordSpelling";
import {
  keepsWrittenMember, readMaskedPreparation, resolvesMaskedStep, unmarkedChordMembers, writtenMemberAt,
} from "../helpers/maskedContinuation";

// Spasobin §§28, 30: the augmented sixth expands by contrary semitones to an octave on scale degree 5.
// The raised second proceeds to the tonic third and the tonic itself stays in place.
export function readWrittenAugmentedSixthSpelling(context: HarmonyRuleContext, motion: MelodyTransition) {
  if (motion.voiceId === "bass" || motion.writtenInterval.semitones !== 1) return;
  const prep = readMaskedPreparation(context, motion);
  if (!prep || prep.middle.key.mode !== "major") return;
  const { voiceId, source, middle, target, trackLocked } = prep;
  const key = middle.key;
  const low = scaleDegreePitchClass(key, 6, -1);
  const high = scaleDegreePitchClass(key, 4, 1);
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  const dominant = scaleDegreePitchClass(key, 5);
  const third = scaleDegreePitchClass(key, 3);
  const tones = [low, high, raisedSecond, key.tonic];
  if (!pitchClassEquals(middle.notes.bass!.pitch, low) || !pitchClassEquals(target.notes.bass!.pitch, dominant)) return;

  const bassSound = toMidi(middle.notes.bass!.pitch);
  if (VOICE_ORDER.some(voice => voice !== "bass" && toMidi(middle.notes[voice]!.pitch) <= bassSound)) return;

  const member = [high, raisedSecond].find(tone => pitchClassValue(tone) === pitchClassValue(motion.current.pitch));
  if (!member || !pitchClassEquals(source, scaleDegreePitchClass(key, pitchClassEquals(member, high) ? 4 : 2))) return;
  const parts = VOICE_ORDER.map(voice => ({ voice, tone: writtenMemberAt(middle, voice, voiceId, member) }));
  if (!tones.every(tone => parts.some(part => pitchClassEquals(part.tone, tone)))) return;
  const goal = completeVoicings(target, voiceId, ["major"]).find(chord =>
    pitchClassEquals(chord.root, key.tonic) && pitchClassEquals(chord.member, target.notes[voiceId]!.pitch));
  if (!goal) return;

  if (!parts.every(({ voice, tone }) => {
    if (pitchClassEquals(tone, low)) return resolvesMaskedStep(middle, target, voice, low, dominant, -1);
    if (pitchClassEquals(tone, high)) return resolvesMaskedStep(middle, target, voice, high, dominant, 1);
    if (pitchClassEquals(tone, raisedSecond)) return resolvesMaskedStep(middle, target, voice, raisedSecond, third, 1);
    return keepsWrittenMember(middle, target, voice);
  })) return;
  if (!unmarkedChordMembers(target, voiceId, goal.member, chordToneSpellings(goal.root, goal.quality), true) ||
      !agreesWithExplicitMembers(middle, voiceId, { root: low, member }, tones, trackLocked) ||
      !agreesWithExplicitIdentity(target, voiceId, goal, trackLocked)) return;
  return { previous: source, current: member };
}
