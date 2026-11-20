import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreesWithExplicitIdentity, completeVoicings, type CompletedVoicing } from "../helpers/maskedChordSpelling";
import {
  crossesWrittenBoundary, keepsWrittenMember, readMaskedPreparation, resolvesMaskedStep,
  unmarkedChordMembers, writtenMemberAt,
} from "../helpers/maskedContinuation";

function completeWrittenChord(
  frame: AnalysisSlice, root: SpelledPitchClass, qualities: readonly ("major" | "dominant7")[],
) {
  return completeVoicings(frame, "bass", qualities).find(chord =>
    pitchClassEquals(chord.root, root) && pitchClassEquals(chord.member, frame.notes.bass!.pitch));
}

function hasLocalMajorConfirmation(
  context: HarmonyRuleContext, landing: AnalysisSlice, tonic: SpelledPitchClass, trackLocked: boolean,
) {
  const key = { tonic, mode: "major" } as const;
  const dominant = scaleDegreePitchClass(key, 5);
  const leading = scaleDegreePitchClass(key, 7);
  const tonicTones = chordToneSpellings(tonic, "major");
  const dominantTriad = chordToneSpellings(dominant, "major");
  const limit = landing.tick + 12 * context.analysis.project.ppq;
  let repeated = false;
  // A foreign I64 is ambiguous by itself. Require another written I64 and a later
  // bass V–I with another voice resolving the written leading tone in place.
  for (const frame of context.slices({ overlapping: { fromTick: landing.tick + 1, toTick: limit } })) {
    if (frame.tick <= landing.tick) continue;
    if (crossesWrittenBoundary(context, landing.tick, frame.tick)) break;
    if (!frame.completeSatb || !frame.attackVoiceIds.length) continue;
    const bass = frame.notes.bass!;
    if (bass.nonChordToneRole || !pitchClassEquals(bass.pitch, dominant)) continue;
    const echo = completeWrittenChord(frame, tonic, ["major"]);
    if (echo && unmarkedChordMembers(frame, "bass", echo.member, tonicTones) &&
        agreesWithExplicitIdentity(frame, "bass", echo, trackLocked)) repeated = true;
    if (!repeated) continue;
    const approach = completeWrittenChord(frame, dominant, ["major", "dominant7"]);
    if (!approach || !unmarkedChordMembers(frame, "bass", approach.member, dominantTriad) ||
        !agreesWithExplicitIdentity(frame, "bass", approach, trackLocked)) continue;
    const arrivalTick = bass.startTick + bass.durationTicks;
    if (arrivalTick >= limit || crossesWrittenBoundary(context, frame.tick, arrivalTick)) continue;
    const arrival = context.sliceAt(arrivalTick);
    if (!arrival?.completeSatb || arrival.tick !== arrivalTick) continue;
    const newBass = arrival.notes.bass!;
    if (newBass.startTick !== arrivalTick || newBass.nonChordToneRole || !pitchClassEquals(newBass.pitch, tonic)) continue;
    if (!VOICE_ORDER.every(voice =>
      tonicTones.some(tone => pitchClassEquals(tone, arrival.notes[voice]!.pitch)))) continue;
    // Only the actually written root and third are needed at the confirming arrival.
    // A fifth is still mandatory in both complete voicings used above.
    if (!VOICE_ORDER.some(voice => !arrival.notes[voice]!.nonChordToneRole &&
          pitchClassEquals(arrival.notes[voice]!.pitch, tonicTones[1])) ||
        !agreesWithExplicitIdentity(arrival, "bass", { root: tonic, quality: "major", member: tonic }, trackLocked)) continue;
    const immediatelyBefore = context.sliceAt(arrivalTick - 1);
    if (!immediatelyBefore?.completeSatb) continue;
    const finalApproach = completeWrittenChord(immediatelyBefore, dominant, ["major", "dominant7"]);
    if (!finalApproach || !unmarkedChordMembers(immediatelyBefore, "bass", finalApproach.member, dominantTriad) ||
        !agreesWithExplicitIdentity(immediatelyBefore, "bass", finalApproach, trackLocked)) continue;
    if (VOICE_ORDER.some(voice => voice !== "bass" &&
          pitchClassEquals(immediatelyBefore.notes[voice]!.pitch, leading) &&
          resolvesMaskedStep(immediatelyBefore, arrival, voice, leading, tonic, 1))) return true;
  }
  return false;
}

function supertonicTendencies(
  middle: AnalysisSlice, target: AnalysisSlice, voiceId: VoiceId, chord: CompletedVoicing,
  tonic: SpelledPitchClass, toTonicSixFour: boolean,
) {
  const key = { tonic, mode: "major" } as const;
  const dominant = scaleDegreePitchClass(key, 5);
  if (!resolvesMaskedStep(middle, target, voiceId, chord.member, dominant, -1)) return false;
  const seventh = VOICE_ORDER.find(voice => pitchClassEquals(
    writtenMemberAt(middle, voice, voiceId, chord.member), tonic));
  if (!seventh) return false;
  if (!toTonicSixFour) {
    return resolvesMaskedStep(middle, target, seventh, tonic, scaleDegreePitchClass(key, 7), -1);
  }
  if (seventh === "bass" || !keepsWrittenMember(middle, target, seventh)) return false;
  const fourth = scaleDegreePitchClass(key, 4);
  return VOICE_ORDER.some(voice => pitchClassEquals(writtenMemberAt(middle, voice, voiceId, chord.member), fourth) &&
    resolvesMaskedStep(middle, target, voice, fourth, scaleDegreePitchClass(key, 3), -1));
}

// Spasobin §21: the lowered fifth descends to scale degree 5. The seventh
// descends into V, or stays in the same voice when the third descends into I64.
export function readWrittenSupertonicSpelling(context: HarmonyRuleContext, motion: MelodyTransition) {
  if (motion.voiceId === "bass" || motion.writtenInterval.semitones !== -1) return;
  const prep = readMaskedPreparation(context, motion);
  if (!prep || prep.middle.key.mode !== "major") return;
  const { voiceId, source, middle, target, trackLocked } = prep;
  const goals = completeVoicings(target, voiceId, ["major"]).filter(goal =>
    pitchClassEquals(goal.member, target.notes[voiceId]!.pitch));
  const candidates = completeVoicings(middle, voiceId, ["halfDiminished7"]);
  for (const goal of goals) {
    const bass = target.notes.bass!.pitch;
    const goalTones = chordToneSpellings(goal.root, goal.quality);
    const toTonicSixFour = pitchClassEquals(bass, goalTones[2]);
    if (!toTonicSixFour && !pitchClassEquals(bass, goal.root)) continue;
    const tonic = toTonicSixFour ? goal.root : scaleDegreePitchClass({ tonic: goal.root, mode: "major" }, 4);
    const key = { tonic, mode: "major" } as const;
    const home = pitchClassEquals(tonic, middle.key.tonic);
    if ((!toTonicSixFour && !home) || !pitchClassEquals(source, scaleDegreePitchClass(key, 6))) continue;
    const chord = candidates.find(candidate => pitchClassEquals(candidate.root, scaleDegreePitchClass(key, 2)) &&
      pitchClassEquals(candidate.member, scaleDegreePitchClass(key, 6, -1)));
    if (!chord || !supertonicTendencies(middle, target, voiceId, chord, tonic, toTonicSixFour) ||
        !unmarkedChordMembers(middle, voiceId, chord.member, chordToneSpellings(chord.root, chord.quality), true) ||
        !unmarkedChordMembers(target, voiceId, goal.member, goalTones, true) ||
        !agreesWithExplicitIdentity(middle, voiceId, chord, trackLocked) ||
        !agreesWithExplicitIdentity(target, voiceId, goal, trackLocked) ||
        (!home && !hasLocalMajorConfirmation(context, target, tonic, trackLocked))) continue;
    return { previous: source, current: chord.member };
  }
}
