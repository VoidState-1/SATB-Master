import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";

// §§14.3, 15.3. In a dominant progression an ascending diminished fifth
// can introduce the seventh, which then descends in the same voice to the tonic third.
export function resolvesDominantSeventhEntry(
  context: HarmonyRuleContext,
  motion: MelodyTransition,
) {
  const { previous, current, writtenInterval, voiceId } = motion;
  if (!motion.contiguous || writtenInterval.diatonicSteps !== 4 || writtenInterval.semitones !== 6)
    return false;

  const tick = current.startTick;
  const release = tick + current.durationTicks;
  const departure = context.sliceAt(tick - 1);
  const entry = context.sliceAt(tick);
  const arrival = context.sliceAt(release);
  if (!departure || !entry || !arrival) return false;
  if (context.analysis.project.keyEvents.some(event => previous.startTick < event.tick && event.tick <= release) ||
      context.analysis.phraseBoundaries.some(boundary => !boundary.stale &&
        previous.startTick < boundary.tick && boundary.tick <= release)) return false;

  const key = departure.key;
  const dominant = scaleDegreePitchClass(key, 5);
  const [, third, , seventh] = chordToneSpellings(dominant, "dominant7");
  const [, tonicThird] = chordToneSpellings(key.tonic, key.mode);
  return pitchClassEquals(previous.pitch, third) && pitchClassEquals(current.pitch, seventh) &&
    matchesWrittenChord(departure, dominant, "major") &&
    context.slices({ overlapping: { fromTick: tick, toTick: release } })
      .all(slice => matchesWrittenChord(slice, dominant, "dominant7")) &&
    matchesWrittenChord(arrival, key.tonic, key.mode) &&
    resolvesInVoice(entry, arrival, voiceId, tonicThird, -1);
}
