import { supportsBassTriad } from "../helpers/bassTriad";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";

// Spasobin, ch. 12 §4: the bass of iv6 can drop a diminished seventh to V6 and resolve to i.
export function isMinorSixthChordBassLine(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { voiceId, previous, current, contiguous, sameKey, writtenInterval } = transition;
  const descendingSeventh = writtenInterval.diatonicSteps === -6 && writtenInterval.semitones === -9;
  if (voiceId !== "bass" || !descendingSeventh || !contiguous || !sameKey ||
      previous.nonChordToneRole || current.nonChordToneRole) return false;

  const key = context.keyAt(previous.startTick);
  if (key?.mode !== "minor" || !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 6))) return false;

  const next = context.notes({ voiceId, startingAfter: current.startTick }).first()?.note;
  if (!next || next.startTick !== current.startTick + current.durationTicks || next.nonChordToneRole) return false;
  const leading = leadingTonePitchClass(key);
  const step = toMidi(next.pitch) - toMidi(current.pitch);
  if (!pitchClassEquals(current.pitch, leading) || !pitchClassEquals(next.pitch, key.tonic) || step !== 1) return false;

  if (context.analysis.project.keyEvents.some(event =>
    previous.startTick < event.tick && event.tick <= next.startTick &&
    (!keyEquals(event, key))) ||
    context.analysis.phraseBoundaries.some(boundary =>
      !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= next.startTick)) return false;

  const soloBass = context.analysis.project.satbTracks.every(track => track.voice === "bass" || !track.notes.length);
  return supportsBassTriad(context, key, previous, current.startTick, 4, "minor", soloBass) &&
    supportsBassTriad(context, key, current, next.startTick, 5, "major", soloBass) &&
    supportsBassTriad(context, key, next, next.startTick + 1, 1, "minor", soloBass);
}
