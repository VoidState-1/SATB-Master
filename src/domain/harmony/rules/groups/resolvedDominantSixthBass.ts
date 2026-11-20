import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { supportsBassTriad } from "../helpers/bassTriad";

// §10.7, ex. 10-129; §18.4, ex. 18-247. The fourth degree descends to the
// third of V6; the same bass must then rise a semitone to the root of I.
export function isResolvedDominantSixthBass(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, writtenInterval } = motion;
  if (motion.voiceId !== "bass" || !motion.contiguous || !motion.sameKey ||
      writtenInterval.diatonicSteps !== -4 || writtenInterval.semitones !== -6) return false;

  const tick = current.startTick;
  const key = context.keyAt(tick);
  const end = tick + current.durationTicks;
  const next = context.sliceAt(end)?.notes.bass;
  if (!key || !next || next.startTick !== end ||
      !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 4)) ||
      !pitchClassEquals(current.pitch, leadingTonePitchClass(key)) ||
      !pitchClassEquals(next.pitch, key.tonic) || toMidi(next.pitch) - toMidi(current.pitch) !== 1) return false;

  if (context.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end) ||
      context.analysis.project.keyEvents.some(e => previous.startTick < e.tick && e.tick <= end &&
        (e.mode !== key.mode || !pitchClassEquals(e.tonic, key.tonic)))) return false;

  const predominant = supportsBassTriad(context, key, previous, tick, 4, key.mode, false, tick - 1) ||
    (key.mode === "major" && supportsBassTriad(context, key, previous, tick, 2, "minor", false, tick - 1));
  return predominant && supportsBassTriad(context, key, current, end, 5, "major", false) &&
    supportsBassTriad(context, key, next, end + 1, 1, key.mode, false);
}
