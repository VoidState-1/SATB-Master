import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import { soundsDeclaredChord } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { sameHarmonyOnTransition } from "../helpers/motionHarmony";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

/** In two complete written V7 voicings, this leap takes over another part's seventh
 * (Liu & Liu, ch. 15 §4). The chord can genuinely remain the same. */
export function previousSeventhInTritoneTransfer(context: HarmonyRuleContext, melody: MelodyTransition) {
  const { voiceId, previous, current, writtenInterval } = melody;
  if (voiceId === "bass" || writtenInterval.diatonicSteps !== -3 || writtenInterval.semitones !== -6 ||
      crossesManualPhraseBoundary(context, previous.startTick, current.startTick)) return;

  const landing = context.sliceAt(current.startTick);
  const transition = landing && context.sliceTransitions({ toSliceIndex: landing.index }).first();
  if (!transition || !sameHarmonyOnTransition(transition, context.harmony)) return;
  const source = transition.previous;
  const target = transition.current;
  const chord = source.chord;
  if (!chord || chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality !== "dominant7" || chord.identity.structure.extensions.length ||
      chord.identity.structure.alterations.length ||
      source.notes[voiceId]?.id !== previous.id || target.notes[voiceId]?.id !== current.id ||
      !soundsDeclaredChord(source) || !soundsDeclaredChord(target)) return;

  const [, third, , seventh] = chordIdentityToneSpellings(chord.identity);
  if (!pitchClassEquals(previous.pitch, third) || !pitchClassEquals(current.pitch, seventh)) return;

  // Full SATB voicings with all four written members have only one seventh at each attack.
  return Object.values(source.notes).find(note =>
    pitchClassEquals(note.pitch, seventh) && note.startTick + note.durationTicks === current.startTick);
}
